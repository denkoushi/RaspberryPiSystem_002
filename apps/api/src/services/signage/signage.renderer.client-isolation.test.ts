import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { SignageRenderer } from './signage.renderer.js';

describe('SignageRenderer client rendering isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a failed client image and continues with later clients', async () => {
    const signageService = {
      listSignageRenderClientApiKeys: vi.fn().mockResolvedValue(['failed-client-key', 'next-client-key']),
      getContent: vi.fn(({ clientKey }: { clientKey: string }) => ({ clientKey })),
    };
    const renderer = new SignageRenderer(signageService as never);
    const renderContent = vi.spyOn(
      renderer as unknown as { renderContent(content: { clientKey: string }): Promise<Buffer> },
      'renderContent',
    ).mockImplementation(async ({ clientKey }) => {
      if (clientKey === 'failed-client-key') throw new Error('render failed');
      return Buffer.from('new image');
    });
    const saveRenderedImage = vi.spyOn(SignageRenderStorage, 'saveRenderedImageForClient')
      .mockResolvedValue({ filename: 'current-next.jpg', filePath: '/render/current-next.jpg' });

    const result = await renderer.renderCurrentContent();

    expect(renderContent).toHaveBeenCalledTimes(2);
    expect(signageService.getContent).toHaveBeenNthCalledWith(1, { clientKey: 'failed-client-key' });
    expect(signageService.getContent).toHaveBeenNthCalledWith(2, { clientKey: 'next-client-key' });
    expect(saveRenderedImage).toHaveBeenCalledOnce();
    expect(saveRenderedImage).toHaveBeenCalledWith(Buffer.from('new image'), 'next-client-key');
    expect(result).toMatchObject({ filename: 'current-next.jpg', clientKeysRendered: 1 });
  });

  it('reports failure when every client render fails without saving an image', async () => {
    const signageService = {
      listSignageRenderClientApiKeys: vi.fn().mockResolvedValue(['failed-client-key']),
      getContent: vi.fn().mockResolvedValue({ clientKey: 'failed-client-key' }),
    };
    const renderer = new SignageRenderer(signageService as never);
    vi.spyOn(
      renderer as unknown as { renderContent(content: { clientKey: string }): Promise<Buffer> },
      'renderContent',
    ).mockRejectedValue(new Error('render failed'));
    const saveRenderedImage = vi.spyOn(SignageRenderStorage, 'saveRenderedImageForClient');

    await expect(renderer.renderCurrentContent()).rejects.toThrow('All client signage images failed to render');
    expect(saveRenderedImage).not.toHaveBeenCalled();
  });
});
