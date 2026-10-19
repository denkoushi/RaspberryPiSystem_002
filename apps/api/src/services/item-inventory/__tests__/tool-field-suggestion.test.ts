import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { read, runtime, warn } = vi.hoisted(() => ({
  read: vi.fn(), runtime: { ensureReady: vi.fn(), release: vi.fn() }, warn: vi.fn(),
}));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { readVisionInferenceJpeg: read } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn } }));
vi.mock('../../inference/inference-runtime.js', () => ({ getInferenceRuntime: vi.fn() }));
vi.mock('../../inference/runtime/get-local-llm-runtime-controller.js', () => ({ getLocalLlmRuntimeController: () => runtime }));

import { ToolFieldSuggestionService } from '../tool-field-suggestion.service.js';

describe('ToolFieldSuggestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockResolvedValue(Buffer.from('jpeg'));
    runtime.ensureReady.mockResolvedValue(undefined);
    runtime.release.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('trims, deduplicates, drops empty/long values and caps candidates without logging text', async () => {
    const complete = vi.fn().mockResolvedValue({ rawText: JSON.stringify({ model: [' M1 ', '', 'M1', 'x'.repeat(81), 'M2', 'M3', 'M4'], maker: [' OSG ', 'OSG', 'A', 'B'] }) });
    expect(await new ToolFieldSuggestionService({ complete }).suggest('/api/storage/photos/a.jpg')).toEqual({ model: ['M1', 'M2', 'M3'], maker: ['OSG', 'A'], status: 'ok' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ imageBytes: Buffer.from('jpeg'), mimeType: 'image/jpeg', temperature: 0, maxTokens: 300, jsonOutput: true, timeoutMs: 30000, signal: expect.any(AbortSignal) }));
    expect(read).toHaveBeenCalledWith('/api/storage/photos/a.jpg', { maxLongEdge: 1280, jpegQuality: 85 });
    expect(runtime.ensureReady).toHaveBeenCalledWith('photo_label');
    expect(runtime.release).toHaveBeenCalledWith('photo_label');
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts fenced JSON', async () => {
    const complete = vi.fn().mockResolvedValue({ rawText: '```json\n{"model":["EX-EDS"],"maker":[]}\n```' });
    expect(await new ToolFieldSuggestionService({ complete }).suggest('/p')).toEqual({ model: ['EX-EDS'], maker: [], status: 'ok' });
  });

  it.each(['garbage', '{"model":"M1","maker":[]}', '{"model":[2],"maker":[]}'])('fails soft on invalid output: %s', async rawText => {
    const complete = vi.fn().mockResolvedValue({ rawText });
    expect(await new ToolFieldSuggestionService({ complete }).suggest('/p')).toEqual({ model: [], maker: [], status: 'unavailable' });
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({ status: 'unavailable', aborted: false }, 'inventory_tool_field_suggestion_unavailable');
  });

  it('fails soft when the vision port throws, without logging the error body', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('sensitive recognised text'));
    expect(await new ToolFieldSuggestionService({ complete }).suggest('/p')).toEqual({ model: [], maker: [], status: 'unavailable' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it('times out even if the port ignores abort, and releases the runtime', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(() => new Promise<never>(() => {}));
    const result = new ToolFieldSuggestionService({ complete }, 100).suggest('/p');
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ model: [], maker: [], status: 'unavailable' });
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it('releases readiness that completes after the deadline, without starting inference', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    runtime.ensureReady.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const complete = vi.fn();
    const result = new ToolFieldSuggestionService({ complete }, 100).suggest('/p');
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).status).toBe('unavailable');
    ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.release).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
});
