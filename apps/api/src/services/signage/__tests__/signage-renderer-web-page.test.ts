import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignageRenderer } from '../signage.renderer.js';
import type { SignageContentResponse } from '../signage.service.js';
import { WebCaptureStorage } from '../web-capture/web-capture-storage.js';

vi.mock('../web-capture/web-capture-storage.js', () => ({
  WebCaptureStorage: { read: vi.fn(), save: vi.fn(), remove: vi.fn() },
}));

const ID = '11111111-1111-4111-8111-111111111111';

type ContentRenderer = { renderContent: (content: SignageContentResponse) => Promise<Buffer> };

const content = {
  contentType: 'TOOLS',
  displayMode: 'SINGLE',
  layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'web_page', config: { webCaptureId: ID } }] },
} as unknown as SignageContentResponse;

describe('SignageRenderer web_page slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fits the stored capture into the signage frame', async () => {
    const captured = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#ff0000' } })
      .jpeg()
      .toBuffer();
    vi.mocked(WebCaptureStorage.read).mockResolvedValue(captured);

    const renderer = Object.create(SignageRenderer.prototype) as ContentRenderer;
    const output = await renderer.renderContent(content);
    const meta = await sharp(output).metadata();

    expect(WebCaptureStorage.read).toHaveBeenCalledWith(ID);
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([1920, 1080]);
    const center = await sharp(output).extract({ left: 940, top: 520, width: 40, height: 40 }).png().toBuffer();
    expect((await sharp(center).stats()).channels[0].mean).toBeGreaterThan(200);
  });

  it('shows a waiting message while nothing has been captured yet', async () => {
    vi.mocked(WebCaptureStorage.read).mockResolvedValue(null);
    const renderer = Object.create(SignageRenderer.prototype) as ContentRenderer & {
      renderMessage: (message: string) => Promise<Buffer>;
    };
    const renderMessage = vi.spyOn(renderer, 'renderMessage').mockResolvedValue(Buffer.from('message'));

    await expect(renderer.renderContent(content)).resolves.toEqual(Buffer.from('message'));
    expect(renderMessage).toHaveBeenCalledWith('ページ撮影待ち');
  });
});
