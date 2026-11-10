import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { SignageRenderer } from './signage.renderer.js';

describe('SignageRenderer client rendering isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a failed client image and continues with later clients', async () => {
    const signageService = {
      listSignageRenderClientDeviceIds: vi.fn().mockResolvedValue(['failed-device-id', 'next-device-id']),
      getContent: vi.fn(({ clientDeviceId }: { clientDeviceId: string }) => ({ clientDeviceId })),
    };
    const renderer = new SignageRenderer(signageService as never);
    const renderContent = vi.spyOn(
      renderer as unknown as { renderContent(content: { clientDeviceId: string }): Promise<Buffer> },
      'renderContent',
    ).mockImplementation(async ({ clientDeviceId }) => {
      if (clientDeviceId === 'failed-device-id') throw new Error('render failed');
      return Buffer.from('new image');
    });
    const saveRenderedImage = vi.spyOn(SignageRenderStorage, 'saveRenderedImageForClient')
      .mockResolvedValue({ filename: 'current-next.jpg', filePath: '/render/current-next.jpg' });

    const result = await renderer.renderCurrentContent();

    expect(renderContent).toHaveBeenCalledTimes(2);
    expect(signageService.getContent).toHaveBeenNthCalledWith(1, { clientDeviceId: 'failed-device-id' });
    expect(signageService.getContent).toHaveBeenNthCalledWith(2, { clientDeviceId: 'next-device-id' });
    expect(saveRenderedImage).toHaveBeenCalledOnce();
    expect(saveRenderedImage).toHaveBeenCalledWith(Buffer.from('new image'), 'next-device-id');
    expect(result).toMatchObject({ filename: 'current-next.jpg', clientKeysRendered: 1 });
  });

  it('reports failure when every client render fails without saving an image', async () => {
    const signageService = {
      listSignageRenderClientDeviceIds: vi.fn().mockResolvedValue(['failed-device-id']),
      getContent: vi.fn().mockResolvedValue({ clientDeviceId: 'failed-device-id' }),
    };
    const renderer = new SignageRenderer(signageService as never);
    vi.spyOn(
      renderer as unknown as { renderContent(content: { clientDeviceId: string }): Promise<Buffer> },
      'renderContent',
    ).mockRejectedValue(new Error('render failed'));
    const saveRenderedImage = vi.spyOn(SignageRenderStorage, 'saveRenderedImageForClient');

    await expect(renderer.renderCurrentContent()).rejects.toThrow('All client signage images failed to render');
    expect(saveRenderedImage).not.toHaveBeenCalled();
  });
});
