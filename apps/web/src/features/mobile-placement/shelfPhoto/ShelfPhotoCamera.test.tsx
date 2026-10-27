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
const applyConstraints = vi.fn();
const track = { stop, applyConstraints };
const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn();
let portrait = false;
let orientation: EventTarget;
const portraitConstraints = { width: { ideal: 960 }, height: { ideal: 1280 }, aspectRatio: { ideal: 3 / 4 } };
const landscapeConstraints = { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 } };
async function rotate(value: boolean) {
  await act(async () => {
    portrait = value;
    orientation.dispatchEvent(new Event('change'));
  });
}
beforeEach(() => {
  portrait = false;
  vi.stubGlobal('createImageBitmap', undefined);
  orientation = new EventTarget();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return portrait; },
    addEventListener: orientation.addEventListener.bind(orientation),
    removeEventListener: orientation.removeEventListener.bind(orientation)
  })));
  applyConstraints.mockReset().mockResolvedValue(undefined);
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
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: 'environment', ...landscapeConstraints } });
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

  it('opens and captures a portrait preview with an 800px long edge', async () => {
    portrait = true;
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(960);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1280);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,PHOTO');
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: 'environment', ...portraitConstraints } });
    const video = document.querySelector('video')!;
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 600, 800);
  });

  it.each(['bitmap', 'rejected'])('corrects landscape capture using %s dimensions', async (mode) => {
    const bitmap = { width: 960, height: 1280, close: vi.fn() };
    const create = vi.fn();
    if (mode === 'bitmap') create.mockResolvedValue(bitmap);
    else {
      create.mockRejectedValue(new Error('unsupported'));
      vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(960);
      vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1280);
    }
    vi.stubGlobal('createImageBitmap', create);
    vi.stubGlobal('screen', { orientation: { angle: 270 } });
    const ctx = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,PHOTO');
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    const video = document.querySelector('video')!;
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));
    expect(await screen.findByAltText('撮影した写真')).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(video);
    expect(ctx.drawImage).toHaveBeenCalledWith(mode === 'bitmap' ? bitmap : video, 0, 0, 600, 800);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(bitmap.close).toHaveBeenCalledTimes(mode === 'bitmap' ? 1 : 0);
  });

  it('discards and releases a bitmap arriving after close', async () => {
    let resolve!: (bitmap: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((done) => { resolve = done; })));
    const onCapture = vi.fn();
    render(<ShelfPhotoCamera onCapture={onCapture} onClose={vi.fn()} onSelectFile={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    const bitmap = { width: 960, height: 1280, close: vi.fn() };
    await act(async () => resolve(bitmap as unknown as ImageBitmap));
    expect(onCapture).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('applies constraints only when orientation changes', async () => {
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(false);
    expect(applyConstraints).not.toHaveBeenCalled();
    await rotate(true);
    expect(applyConstraints).toHaveBeenCalledExactlyOnceWith(portraitConstraints);
    await rotate(true);
    expect(applyConstraints).toHaveBeenCalledTimes(1);
    await rotate(false);
    expect(applyConstraints).toHaveBeenLastCalledWith(landscapeConstraints);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reopens the camera and stops the old stream if constraints fail', async () => {
    const replacementStop = vi.fn();
    const replacement = { getTracks: () => [{ stop: replacementStop }] } as unknown as MediaStream;
    getUserMedia.mockResolvedValueOnce(stream).mockResolvedValueOnce(replacement);
    applyConstraints.mockRejectedValueOnce(new Error('unsupported'));
    const view = render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: { facingMode: 'environment', ...portraitConstraints } });
    expect(document.querySelector('video')!.srcObject).toBe(replacement);
    expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled();
    view.unmount();
    expect(replacementStop).toHaveBeenCalledTimes(1);
  });

  it('stops a replacement stream arriving after close even without unmounting', async () => {
    let resolve!: (stream: MediaStream) => void;
    const replacementStop = vi.fn();
    const replacement = { getTracks: () => [{ stop: replacementStop }] } as unknown as MediaStream;
    getUserMedia.mockResolvedValueOnce(stream).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    applyConstraints.mockRejectedValueOnce(new Error('unsupported'));
    render(<ShelfPhotoCamera onCapture={vi.fn()} onClose={vi.fn()} onSelectFile={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(true);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => resolve(replacement));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(replacementStop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('video')!.srcObject).toBeNull();
  });

  it('does not reopen after closing during applyConstraints', async () => {
    let reject!: (error: Error) => void;
    applyConstraints.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(true);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => reject(new Error('unsupported')));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('applies the latest orientation after an in-flight change', async () => {
    let resolve!: () => void;
    applyConstraints.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(true);
    await rotate(false);
    expect(applyConstraints).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(applyConstraints).toHaveBeenCalledTimes(2);
    expect(applyConstraints).toHaveBeenLastCalledWith(landscapeConstraints);
    expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled();
  });

  it.each(['screen', 'resize'])('uses the %s fallback without matchMedia', async (source) => {
    vi.stubGlobal('matchMedia', undefined);
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('screen', { orientation: source === 'screen' ? orientation : undefined });
    const view = render(<Camera />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: 'environment', ...portraitConstraints } });
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 400);
    await act(async () => {
      if (source === 'screen') orientation.dispatchEvent(new Event('change'));
      else window.dispatchEvent(new Event('resize'));
    });
    expect(applyConstraints).toHaveBeenCalledExactlyOnceWith(landscapeConstraints);
    view.unmount();
  });

  it('offers file selection if reopening fails', async () => {
    getUserMedia.mockResolvedValueOnce(stream).mockRejectedValueOnce(new Error('denied'));
    applyConstraints.mockRejectedValueOnce(new Error('unsupported'));
    const onSelectFile = vi.fn();
    render(<Camera onSelectFile={onSelectFile} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
    await rotate(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラを使えません');
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }));
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
