import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { read, runtime, warn } = vi.hoisted(() => ({
  read: vi.fn(), runtime: { ensureReady: vi.fn(), release: vi.fn() }, warn: vi.fn(),
}));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { readPhoto: read } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn } }));
vi.mock('../../inference/inference-runtime.js', () => ({ getInferenceRuntime: vi.fn() }));
vi.mock('../../inference/runtime/get-local-llm-runtime-controller.js', () => ({ getLocalLlmRuntimeController: () => runtime }));

import { PhotoRegionReadService } from '../photo-region-read.service.js';

const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.3 };

describe('PhotoRegionReadService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    read.mockResolvedValue(await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer());
    runtime.ensureReady.mockResolvedValue(undefined);
    runtime.release.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('crops the original, trims, deduplicates and limits candidates without logging text', async () => {
    const complete = vi.fn().mockResolvedValue({ rawText: JSON.stringify({ candidates: [' M1 ', '', 'M1', 'x'.repeat(121), 'M2', 'M3', 'M4', 'M5'] }) });
    expect(await new PhotoRegionReadService({ complete }).read('/api/storage/photos/a.jpg', bbox)).toEqual({ candidates: ['M1', 'x'.repeat(120), 'M2', 'M3', 'M4'], status: 'ok' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg', temperature: 0, maxTokens: 1000, jsonOutput: true, timeoutMs: 30000, signal: expect.any(AbortSignal) }));
    const metadata = await sharp(complete.mock.calls[0][0].imageBytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([40, 30]);
    expect(read).toHaveBeenCalledWith('/api/storage/photos/a.jpg');
    expect(runtime.ensureReady).toHaveBeenCalledWith('photo_label');
    expect(runtime.release).toHaveBeenCalledWith('photo_label');
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts fenced JSON', async () => {
    const complete = vi.fn().mockResolvedValue({ rawText: '```json\n{"candidates":["EX-EDS"]}\n```' });
    expect(await new PhotoRegionReadService({ complete }).read('/p', bbox)).toEqual({ candidates: ['EX-EDS'], status: 'ok' });
  });

  it.each(['garbage', '{"candidates":"M1"}', '{"candidates":[2]}', 'null', '[]', '{}', '{"candidates":[],"extra":1}'])('returns no candidates for invalid output: %s', async rawText => {
    const complete = vi.fn().mockResolvedValue({ rawText });
    expect(await new PhotoRegionReadService({ complete }).read('/p', bbox)).toEqual({ candidates: [], status: 'ok' });
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('aborts on client disconnect', async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn();
    expect(await new PhotoRegionReadService({ complete }).read('/p', bbox, controller.signal)).toEqual({ candidates: [], status: 'unavailable' });
    expect(read).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('fails soft when the vision port throws, without logging the error body', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('sensitive recognised text'));
    expect(await new PhotoRegionReadService({ complete }).read('/p', bbox)).toEqual({ candidates: [], status: 'unavailable' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it('times out even if the port ignores abort, and releases the runtime', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(() => new Promise<never>(() => {}));
    const result = new PhotoRegionReadService({ complete }, 100).read('/p', bbox);
    await vi.waitFor(() => expect(runtime.ensureReady).toHaveBeenCalled(), { interval: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ candidates: [], status: 'unavailable' });
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it('releases readiness that completes after the deadline, without starting inference', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    runtime.ensureReady.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const complete = vi.fn();
    const result = new PhotoRegionReadService({ complete }, 100).read('/p', bbox);
    await vi.waitFor(() => expect(runtime.ensureReady).toHaveBeenCalled(), { interval: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).status).toBe('unavailable');
    ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
});
