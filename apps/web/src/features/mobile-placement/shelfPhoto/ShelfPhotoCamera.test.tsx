import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShelfPhotoCamera } from './ShelfPhotoCamera';

import type { ShelfPhotoData } from './resizeShelfPhoto';

function Camera({ onSelectFile = vi.fn() }: { onSelectFile?: () => void }) {
  const [open, setOpen] = useState(true);
  const [photo, setPhoto] = useState<ShelfPhotoData | null>(null);
  return <>
    {open && <ShelfPhotoCamera onCapture={(value) => { setPhoto(value); setOpen(false); }} onClose={() => setOpen(false)} onSelectFile={onSelectFile} />}
    {photo && <img alt="撮影した写真" src={`data:${photo.contentType};base64,${photo.dataBase64}`} />}
  </>;
}

const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
beforeEach(() => {
  stop.mockReset();
  getUserMedia.mockReset().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(960);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ShelfPhotoCamera', () => {
  it('captures the preview as an 800px JPEG and stops the stream', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,PHOTO');
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } } });
    const video = document.querySelector('video')!;
    expect(video.srcObject).toBe(stream);
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));
    expect(screen.getByAltText('撮影した写真')).toHaveAttribute('src', 'data:image/jpeg;base64,PHOTO');
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 800, 600);
    expect(encode).toHaveBeenCalledWith('image/jpeg', 0.8);
    const canvas = encode.mock.instances[0];
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops on close', async () => {
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops a stream that arrives after closing while permission is pending', async () => {
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<Camera />);
    expect(screen.getByRole('button', { name: '撮る' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops when unmounted', async () => {
    const view = render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'denied', 'play'])('offers file selection when camera is %s', async (failure) => {
    if (failure === 'missing') vi.stubGlobal('navigator', {});
    if (failure === 'denied') getUserMedia.mockRejectedValue(new Error('denied'));
    if (failure === 'play') vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('play failed'));
    const onSelectFile = vi.fn();
    render(<Camera onSelectFile={onSelectFile} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラを使えません');
    fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }));
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    if (failure === 'play') expect(stop).toHaveBeenCalledTimes(1);
  });
});
