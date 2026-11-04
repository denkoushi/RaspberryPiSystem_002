import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignageRenderStorage } from '../../../lib/signage-render-storage.js';
import type { SignageContentResponse, SignageService } from '../signage.service.js';
import { SignageRenderer } from '../signage.renderer.js';

vi.mock('../../../lib/signage-render-storage.js', () => ({
  SignageRenderStorage: {
    saveRenderedImageForClient: vi.fn(async (_buffer: Buffer, clientKey: string) => ({
      filename: `${clientKey}.jpg`,
    })),
    saveLegacyGlobalImage: vi.fn(),
  },
}));

const contentFor = (pdfId: string): SignageContentResponse =>
  ({
    contentType: 'PDF',
    displayMode: 'SINGLE',
    pdf: { id: pdfId, name: pdfId, pages: [], slideInterval: null },
  }) as unknown as SignageContentResponse;

function setup(contents: Record<string, SignageContentResponse>) {
  const service = {
    listSignageRenderClientApiKeys: vi.fn(async () => Object.keys(contents)),
    getContent: vi.fn(async ({ clientKey }: { clientKey: string }) => contents[clientKey]),
  } as unknown as SignageService;
  const renderer = new SignageRenderer(service);
  const renderContent = vi.fn(async (content: SignageContentResponse) =>
    Buffer.from(`img:${content.pdf?.id ?? ''}`),
  );
  (renderer as unknown as { renderContent: typeof renderContent }).renderContent = renderContent;
  return { service, renderer, renderContent };
}

describe('SignageRenderer per-cycle render dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders identical payloads once and still saves an image for every client', async () => {
    const { service, renderer, renderContent } = setup({
      a: contentFor('p1'),
      b: contentFor('p1'),
      c: contentFor('p1'),
      d: contentFor('p2'),
    });

    const result = await renderer.renderCurrentContent();

    expect(result.clientKeysRendered).toBe(4);
    expect(service.getContent).toHaveBeenCalledTimes(4);
    expect(renderContent).toHaveBeenCalledTimes(2);
    const saves = vi.mocked(SignageRenderStorage.saveRenderedImageForClient).mock.calls;
    expect(saves.map(([, key]) => key)).toEqual(['a', 'b', 'c', 'd']);
    expect(saves.map(([buffer]) => buffer.toString())).toEqual(['img:p1', 'img:p1', 'img:p1', 'img:p2']);
  });

  it('does not reuse a failed render, so the next client with the same payload retries', async () => {
    const { renderer, renderContent } = setup({ a: contentFor('p1'), b: contentFor('p1'), c: contentFor('p1') });
    renderContent.mockRejectedValueOnce(new Error('transient'));

    const result = await renderer.renderCurrentContent();

    expect(renderContent).toHaveBeenCalledTimes(2);
    expect(result.clientKeysRendered).toBe(2);
    const saves = vi.mocked(SignageRenderStorage.saveRenderedImageForClient).mock.calls;
    expect(saves.map(([, key]) => key)).toEqual(['b', 'c']);
  });

  it('keeps the all-clients-failed error', async () => {
    const { renderer, renderContent } = setup({ a: contentFor('p1'), b: contentFor('p1') });
    renderContent.mockRejectedValue(new Error('down'));

    await expect(renderer.renderCurrentContent()).rejects.toThrow('All client signage images failed to render');
    expect(renderContent).toHaveBeenCalledTimes(2);
  });

  it('does not share renders across cycles', async () => {
    const { renderer, renderContent } = setup({ a: contentFor('p1'), b: contentFor('p1') });

    await renderer.renderCurrentContent();
    await renderer.renderCurrentContent();

    expect(renderContent).toHaveBeenCalledTimes(2);
  });
});
