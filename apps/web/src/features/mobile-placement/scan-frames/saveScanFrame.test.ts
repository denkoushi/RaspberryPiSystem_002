import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeScanFrame, saveScanFrame, type FrameDetails } from './saveScanFrame';
import { scanFrameStore } from './scanFrameStore';

import type { ScanFrameCapture } from '../../barcode-scan/scanFrameCapture';

vi.mock('./scanFrameStore', () => ({ scanFrameStore: { put: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../sync/syncScheduler', () => ({ requestSync: vi.fn() }));
const capture = (): ScanFrameCapture => {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = 1280; fullCanvas.height = 720;
  return { outcome: 'timeout', decodedValue: null, decodeMs: 30000, retryCount: 20, engine: 'native',
    camera: { videoWidth: 1920, videoHeight: 1080 }, cropBox: null, fullCanvas, capturedAt: '2026-10-29T00:00:00Z' };
};
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('idle JPEG persistence', () => {
  it('defers JPEG and DB work to idle and includes an intervening manual input', async () => {
    let work!: IdleRequestCallback;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => { work = callback; }));
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) { callback(new Blob(['jpeg'])); });
    const details: FrameDetails = { kind: 'scan-frame' };
    saveScanFrame(capture(), details);
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(encode).not.toHaveBeenCalled(); expect(scanFrameStore.put).not.toHaveBeenCalled();
    details.manualValue = '001';
    work({} as IdleDeadline);
    await vi.waitFor(() => expect(scanFrameStore.put).toHaveBeenCalled());
    expect(scanFrameStore.put).toHaveBeenCalledWith(expect.objectContaining({ manualValue: '001', kind: 'scan-frame' }));
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.7);
  });
  it('uses setTimeout(0) when idle callback is unavailable', async () => {
    vi.useFakeTimers(); vi.stubGlobal('requestIdleCallback', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'])));
    saveScanFrame(capture(), { kind: 'placement-photo', clientRecordId: 'placement', shelfCodeRaw: 'A' });
    expect(scanFrameStore.put).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(scanFrameStore.put).toHaveBeenCalledWith(expect.objectContaining({ clientRecordId: 'placement', shelfCodeRaw: 'A' }));
  });
  it('maps original crop coordinates to the saved frame, pads line bounds and caps crop at 640px', async () => {
    const draw = vi.fn();
    const sizes: [number, number][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      sizes.push([this.width, this.height]); callback(new Blob(['jpeg']));
    });
    const frame = capture();
    frame.cropBox = { x: 0, y: 500, width: 1500, height: 0 };
    const result = await encodeScanFrame(frame);
    expect(result.cropJpeg).toBeDefined();
    expect(sizes[1][0]).toBe(640); expect(sizes[1][1]).toBeGreaterThan(0);
    expect(draw).toHaveBeenCalledWith(frame.fullCanvas, 0, expect.any(Number), 1150, 300, 0, 0, 640, expect.any(Number));
  });
});
