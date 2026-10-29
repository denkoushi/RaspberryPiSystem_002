import { act, renderHook, waitFor } from '@testing-library/react';
import { BarcodeFormat } from '@zxing/library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCameraStream, stopCameraStream } from '../../../utils/camera';
import { useBarcodeScanSession } from '../useBarcodeScanSession';
import { createBrowserMultiFormatReader } from '../zxingVideoReader';

import type { ScanFrameCapture } from '../scanFrameCapture';

vi.mock('../../../utils/camera', () => ({ getCameraStream: vi.fn(), stopCameraStream: vi.fn() }));
vi.mock('../zxingVideoReader', () => ({ createBrowserMultiFormatReader: vi.fn() }));

const formats = [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF];
const getSettings = vi.fn();
const getCapabilities = vi.fn();
const getVideoTracks = vi.fn();
const stream = { getVideoTracks } as unknown as MediaStream;
const decodeFromStream = vi.fn();
const detect = vi.fn();
const getUserMedia = vi.fn();
const supported = vi.fn();
class Detector {
  static getSupportedFormats = supported;
  detect = detect;
}

function session(engine?: 'auto-native', onFrameCaptured?: (capture: ScanFrameCapture) => void) {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { value: 2 });
  Object.defineProperty(video, 'videoWidth', { value: 1920 });
  Object.defineProperty(video, 'videoHeight', { value: 1080 });
  video.play = vi.fn().mockResolvedValue(undefined);
  const onSuccess = vi.fn();
  const onAbort = vi.fn();
  const options = {
    active: true, onFrameCaptured, videoRef: { current: video }, formats, engine, idleTimeoutMs: 30_000,
    stabilityConfig: { requiredConsecutiveHits: 2, stableWindowMs: 600 }, onSuccess, onAbort
  };
  return { ...renderHook(() => useBarcodeScanSession(options)), onSuccess, onAbort };
}

beforeEach(() => {
  vi.resetAllMocks();
  getVideoTracks.mockReturnValue([{ getSettings, getCapabilities }]);
  getSettings.mockReturnValue({ width: 1920, height: 1080, torch: true, zoom: 2, deviceId: 'do-not-retain' });
  getCapabilities.mockReturnValue({ zoom: { min: 1, max: 3 }, torch: true });
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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

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


describe('optional scan frame capture', () => {
  it('does not create canvas or read camera settings without the prop, including errors and timeout', async () => {
    const create = vi.spyOn(document, 'createElement');
    const { onSuccess, unmount } = session();
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
    const decode = decodeFromStream.mock.calls[0][2];
    act(() => decode(undefined, new Error('not found')));
    act(() => decode({ getText: () => '001' }));
    act(() => decode({ getText: () => '001' }));
    expect(onSuccess).toHaveBeenCalledWith('001');
    expect(create.mock.calls.some(([tag]) => tag === 'canvas')).toBe(false);
    expect(getVideoTracks).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
    unmount();
  });
  it('draws once before stopping, snapshots metadata once and counts native misses', async () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { nextFrame = callback; return 1; }));
    detect.mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: '001', boundingBox: { x: 100, y: 200, width: 500, height: 100 } }]);
    const captured = vi.fn();
    const { unmount } = session('auto-native', captured);
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
    await act(async () => { nextFrame?.(0); });
    await act(async () => { nextFrame?.(0); });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(stopCameraStream).mock.invocationCallOrder[0]);
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'decoded', decodedValue: '001', retryCount: 1, engine: 'native', torchOn: true, zoom: 2 }));
    expect(captured.mock.calls[0][0].fullCanvas.width).toBe(1280);
    expect(captured.mock.calls[0][0].camera.deviceId).toBeUndefined();
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(getCapabilities).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('captures ZXing point bounds and error count', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const captured = vi.fn();
    const { unmount } = session(undefined, captured);
    await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
    const decode = decodeFromStream.mock.calls[0][2];
    const value = { getText: () => '001', getResultPoints: () => [{ getX: () => 20, getY: () => 50 }, { getX: () => 200, getY: () => 50 }] };
    act(() => { decode(undefined, new Error('not found')); decode(value); decode(value); });
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ engine: 'zxing', retryCount: 1, cropBox: { x: 20, y: 50, width: 180, height: 0 } }));
    unmount();
  });
  it.each([undefined, 'auto-native'] as const)('excludes camera startup from decodeMs (%s)', async (engine) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    let acquire!: (value: MediaStream) => void;
    const camera = new Promise<MediaStream>((resolve) => { acquire = resolve; });
    getUserMedia.mockReturnValue(camera);
    vi.mocked(getCameraStream).mockReturnValue(camera);
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { nextFrame = callback; return 1; }));
    const captured = vi.fn();
    const { unmount } = session(engine, captured);
    await waitFor(() => expect(engine ? getUserMedia : getCameraStream).toHaveBeenCalled());
    clock.mockReturnValue(5000);
    await act(async () => { acquire(stream); });
    clock.mockReturnValue(5100);
    await act(async () => {
      if (engine) nextFrame?.(0);
      else {
        const decode = decodeFromStream.mock.calls[0][2];
        const value = { getText: () => '001', getResultPoints: () => [] };
        decode(value); decode(value);
      }
    });
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ decodeMs: 100 }));
    unmount();
  });
  it('captures timeout before stopping but never captures explicit cancellation', async () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.useFakeTimers();
    const captured = vi.fn();
    const first = session(undefined, captured);
    await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(30000));
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout', decodedValue: null, decodeMs: 30000 }));
    expect(draw.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(stopCameraStream).mock.invocationCallOrder[0]);
    first.unmount();
    const second = session(undefined, captured);
    await act(async () => { await Promise.resolve(); });
    act(() => second.result.current.requestCancel());
    expect(captured).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});
