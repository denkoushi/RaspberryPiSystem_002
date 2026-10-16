import { act, renderHook, waitFor } from '@testing-library/react';
import { BarcodeFormat } from '@zxing/library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCameraStream, stopCameraStream } from '../../../utils/camera';
import { useBarcodeScanSession } from '../useBarcodeScanSession';
import { createBrowserMultiFormatReader } from '../zxingVideoReader';

vi.mock('../../../utils/camera', () => ({ getCameraStream: vi.fn(), stopCameraStream: vi.fn() }));
vi.mock('../zxingVideoReader', () => ({ createBrowserMultiFormatReader: vi.fn() }));

const formats = [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF];
const stream = {} as MediaStream;
const decodeFromStream = vi.fn();
const detect = vi.fn();
const getUserMedia = vi.fn();
const supported = vi.fn();
class Detector {
  static getSupportedFormats = supported;
  detect = detect;
}

function session(engine?: 'auto-native') {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { value: 2 });
  video.play = vi.fn().mockResolvedValue(undefined);
  const onSuccess = vi.fn();
  const onAbort = vi.fn();
  const options = {
    active: true, videoRef: { current: video }, formats, engine, idleTimeoutMs: 30_000,
    stabilityConfig: { requiredConsecutiveHits: 2, stableWindowMs: 600 }, onSuccess, onAbort
  };
  return { ...renderHook(() => useBarcodeScanSession(options)), onSuccess, onAbort };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('BarcodeDetector', Detector);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  supported.mockResolvedValue(['code_128', 'code_39', 'itf']);
  detect.mockResolvedValue([{ rawValue: '1234567890', format: 'code_128' }]);
  getUserMedia.mockResolvedValue(stream);
  vi.mocked(getCameraStream).mockResolvedValue(stream);
  vi.mocked(createBrowserMultiFormatReader).mockReturnValue({
    decodeFromStream, stopContinuousDecode: vi.fn(), reset: vi.fn()
  } as unknown as ReturnType<typeof createBrowserMultiFormatReader>);
});
afterEach(() => vi.unstubAllGlobals());

describe('barcode session engine', () => {
  it('uses native 720p and confirms only after stable reads', async () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { nextFrame = callback; return 1; }));
    const { onSuccess, unmount } = session('auto-native');
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: {
      facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }
    } });
    await act(async () => { nextFrame?.(0); });
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('1234567890');
    expect(createBrowserMultiFormatReader).not.toHaveBeenCalled();
    expect(stopCameraStream).toHaveBeenCalledWith(stream);
    unmount();
  });
  it.each(['absent', 'unsupported', 'throws'])('falls back to unchanged ZXing when native is %s', async (mode) => {
    if (mode === 'absent') vi.stubGlobal('BarcodeDetector', undefined);
    if (mode === 'unsupported') supported.mockResolvedValue(['code_128']);
    if (mode === 'throws') supported.mockRejectedValue(new Error('unsupported'));
    const { onSuccess, unmount } = session('auto-native');
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
    expect(getCameraStream).toHaveBeenCalledWith();
    expect(getUserMedia).not.toHaveBeenCalled();
    const decode = decodeFromStream.mock.calls[0][2];
    act(() => decode({ getText: () => '1234567890' }));
    expect(onSuccess).not.toHaveBeenCalled();
    act(() => decode({ getText: () => '1234567890' }));
    expect(onSuccess).toHaveBeenCalledWith('1234567890');
    unmount();
  });
  it('keeps default sessions on ZXing even with native support', async () => {
    const { unmount } = session();
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
    expect(supported).not.toHaveBeenCalled();
    expect(getCameraStream).toHaveBeenCalledWith();
    unmount();
  });
  it('ignores an in-flight detection after cancellation', async () => {
    let resolve!: (values: { rawValue: string }[]) => void;
    detect.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result, onSuccess, onAbort, unmount } = session('auto-native');
    await waitFor(() => expect(detect).toHaveBeenCalled());
    act(() => result.current.requestCancel());
    await act(async () => resolve([{ rawValue: '1234567890' }]));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(stopCameraStream).toHaveBeenCalledWith(stream);
    unmount();
  });
});
