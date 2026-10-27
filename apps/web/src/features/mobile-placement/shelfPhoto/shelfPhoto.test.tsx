import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementShelfPhoto } from '../../../api/client';

import { resizeShelfPhoto } from './resizeShelfPhoto';
import { useShelfPhoto } from './useShelfPhoto';

import type { ReactNode } from 'react';

vi.mock('../../../api/client', () => ({ getMobilePlacementShelfPhoto: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shelf photos', () => {
  it('fetches versioned Blobs, reuses query cache and revokes object URLs', async () => {
    const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const first = new Blob(['first']); const second = new Blob(['second']);
    vi.mocked(getMobilePlacementShelfPhoto).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(({ version }) => useShelfPhoto('西-北-01', version), { wrapper, initialProps: { version: 'v1' } });
    await waitFor(() => expect(hook.result.current.url).toBe('blob:first'));
    expect(getMobilePlacementShelfPhoto).toHaveBeenCalledWith('西-北-01', 'v1');
    hook.rerender({ version: 'v2' });
    await waitFor(() => expect(hook.result.current.url).toBe('blob:second'));
    expect(revoke).toHaveBeenCalledWith('blob:first');
    hook.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:second');
    expect(client.getQueryData(['mobile-placement', 'shelf-photo', '西-北-01', 'v1'])).toBe(first);
  });
  it.each(['missing', 'rejected'])('uses Image when bitmap is %s, resizes the longest side to 800px and encodes JPEG at quality 0.8', async (bitmapMode) => {
    vi.stubGlobal('createImageBitmap', bitmapMode === 'missing' ? undefined : vi.fn().mockRejectedValue(new Error('unsupported')));
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:input', revokeObjectURL: revoke });
    const image = { onload: () => {}, naturalWidth: 1600, naturalHeight: 900, src: '' };
    vi.stubGlobal('Image', class { constructor() { return image; } });
    const draw = vi.fn(); const encode = vi.fn().mockReturnValue('data:image/jpeg;base64,ENCODED');
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: encode };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const result = resizeShelfPhoto(new File(['image'], 'shelf.png'));
    await act(async () => { await Promise.resolve(); image.onload(); });
    expect(await result).toEqual({ contentType: 'image/jpeg', dataBase64: 'ENCODED' });
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    expect(draw).toHaveBeenCalledWith(image, 0, 0, 800, 450);
    expect(encode).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect(revoke).toHaveBeenCalledWith('blob:input');
    expect(image.src).toBe('');
  });
});


describe('bitmap resizing', () => {
  it.each([[800, 600, 800, 600], [800, 1200, 533, 800]])('encodes %sx%s and closes the bitmap', async (width, height, outputWidth, outputHeight) => {
    const bitmap = { width, height, close: vi.fn() };
    const create = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', create);
    const image = vi.fn(); vi.stubGlobal('Image', image);
    const draw = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,ENCODED') };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const file = new File(['image'], 'shelf.jpg');
    expect(await resizeShelfPhoto(file)).toEqual({ contentType: 'image/jpeg', dataBase64: 'ENCODED' });
    expect(create).toHaveBeenCalledWith(file, { resizeWidth: 800, resizeQuality: 'high', imageOrientation: 'from-image' });
    expect(image).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, outputWidth, outputHeight);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });

  it('releases the bitmap and canvas even if encoding fails', async () => {
    const bitmap = { width: 800, height: 600, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const canvas = { width: 0, height: 0, getContext: () => null };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    await expect(resizeShelfPhoto(new File(['image'], 'shelf.jpg'))).rejects.toThrow('写真を処理できませんでした');
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
});
