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
  it('resizes the longest side to 800px and encodes JPEG at quality 0.8', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:input', revokeObjectURL: revoke });
    const image = { onload: () => {}, naturalWidth: 1600, naturalHeight: 900, src: '' };
    vi.stubGlobal('Image', class { constructor() { return image; } });
    const draw = vi.fn(); const encode = vi.fn().mockReturnValue('data:image/jpeg;base64,ENCODED');
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: encode };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const result = resizeShelfPhoto(new File(['image'], 'shelf.png'));
    await act(async () => image.onload());
    expect(await result).toEqual({ contentType: 'image/jpeg', dataBase64: 'ENCODED' });
    expect(canvas.width).toBe(800); expect(canvas.height).toBe(450);
    expect(draw).toHaveBeenCalledWith(image, 0, 0, 800, 450);
    expect(encode).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect(revoke).toHaveBeenCalledWith('blob:input');
  });
});
