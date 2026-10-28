import { afterEach, describe, expect, it, vi } from 'vitest';

import { rotateShelfPhoto } from './resizeShelfPhoto';

afterEach(() => { vi.restoreAllMocks(); });

describe('rotateShelfPhoto', () => {
  it('turns the photo 90 degrees clockwise and releases the canvas', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, value: string) {
      if (value) queueMicrotask(() => this.onload?.(new Event('load')));
    });
    const ctx = { translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      return `data:image/jpeg;base64,${this.width}x${this.height}`;
    });
    const result = await rotateShelfPhoto({ contentType: 'image/jpeg', dataBase64: 'SRC' });
    expect(result).toEqual({ contentType: 'image/jpeg', dataBase64: '600x800' });
    expect(ctx.translate).toHaveBeenCalledWith(600, 0);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0);
    const canvas = encode.mock.instances[0];
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });

  it('reports a photo that cannot be read', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, value: string) {
      if (value) queueMicrotask(() => this.onerror?.(new Event('error')));
    });
    await expect(rotateShelfPhoto({ contentType: 'image/jpeg', dataBase64: 'BAD' })).rejects.toThrow('写真を回せませんでした');
  });
});
