import { describe, expect, it, vi } from 'vitest';

import type { CameraFrame, Judgement } from '../watch-camera-processor.js';
import { parsePersonResponse, WatchCameraCapacity, WatchCameraProcessor } from '../watch-camera-processor.js';

function setup() {
  let now = 0;
  const judge = vi.fn(async () => false);
  const save = vi.fn(async (_device: string, _frame: CameraFrame, _judgement: Judgement) => true);
  const processor = new WatchCameraProcessor({ now: () => new Date(now), judgeIntervalMs: 30_000,
    unjudgedIntervalMs: 60_000, judge, save });
  return { judge, save, processor, receive: async (time: number, device = 'a') => {
    now = time; await processor.receive(device, Buffer.from(String(time)));
  } };
}

describe('watch camera processor', () => {
  it('judges at 30 second boundaries and keeps devices independent', async () => {
    const s = setup();
    for (const time of [0, 10_000, 20_000, 29_999, 30_000]) await s.receive(time);
    expect(s.judge).toHaveBeenCalledTimes(2);
    await s.receive(30_000, 'b');
    expect(s.judge).toHaveBeenCalledTimes(3);
    expect(s.save).not.toHaveBeenCalled();
  });
  it('saves three preceding frames, current, and three following frames without duplicates', async () => {
    const s = setup();
    for (const time of [0, 10_000, 20_000]) await s.receive(time);
    s.judge.mockResolvedValue(true);
    for (const time of [30_000, 40_000, 50_000, 60_000, 70_000]) await s.receive(time);
    expect(s.save.mock.calls.map((call) => call[1].capturedAt.getTime()))
      .toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000]);
    expect(s.save.mock.calls.every((call) => call[2] === 'person')).toBe(true);
    expect(s.judge).toHaveBeenCalledTimes(3);
  });
  it('thins failed judgements to one unjudged frame a minute and still throttles inference', async () => {
    const s = setup(); s.judge.mockRejectedValue(new Error('unavailable'));
    for (const time of [0, 10_000, 30_000, 59_999, 60_000]) await s.receive(time);
    expect(s.judge).toHaveBeenCalledTimes(3);
    expect(s.save).toHaveBeenCalledTimes(2);
    expect(s.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ capturedAt: new Date(60_000) }), 'unjudged');
  });
  it('drops frames from a processing device and does not queue global inference', async () => {
    const s = setup(); let finish!: (person: boolean) => void;
    s.judge.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = s.receive(0);
    await s.receive(10_000);
    await s.receive(10_000, 'b');
    expect(s.judge).toHaveBeenCalledTimes(1);
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(s.save).toHaveBeenCalledWith('b', expect.anything(), 'unjudged');
    finish(false); await pending;
    s.judge.mockResolvedValue(true);
    await s.receive(30_000);
    expect(s.save.mock.calls.filter((call) => call[0] === 'a')).toHaveLength(2);
  });
  it('releases the processing flag after storage errors', async () => {
    const s = setup(); s.judge.mockResolvedValue(true); s.save.mockRejectedValueOnce(new Error('disk'));
    await expect(s.receive(0)).rejects.toThrow('disk');
    await s.receive(30_000);
    expect(s.judge).toHaveBeenCalledTimes(2);
  });
});

describe('watch camera judgement JSON', () => {
  it.each([
    [true, 0.49, 0.5, false], [true, 0.5, 0.5, true], [true, 0.7, 0.8, false],
    [true, 0.8, 0.8, true], [false, 1, 0.5, false], [true, 0, 0, true], [true, 1, 1, true],
  ] as const)('applies threshold: person=%s confidence=%s threshold=%s', (person, confidence, threshold, expected) => {
    expect(parsePersonResponse(JSON.stringify({ person, confidence }), threshold)).toBe(expected);
  });
  it('uses unjudged fallback for missing confidence', async () => {
    const s = setup();
    s.judge.mockImplementation(async () => parsePersonResponse('{"person":true}'));
    await s.receive(0);
    expect(s.save).toHaveBeenCalledWith('a', expect.anything(), 'unjudged');
  });
  it.each([true, false])('accepts a boolean person with valid confidence: %s', (person) => {
    expect(parsePersonResponse(JSON.stringify({ person, confidence: 0.5 }))).toBe(person);
  });
  it.each(['{"person":true}', '{"person":true,"confidence":-0.1}', '{"person":true,"confidence":1.1}', '{"person":false,"confidence":null}', '{"person":true,"confidence":"0.9"}', '{"person":true,"confidence":1e999}', '{"person":"true","confidence":0.9}', '{"person":true,"confidence":0.9,"extra":0}', '{"person":"true"}', '{}', 'null', 'true', '[]', '{"person":1}', '{"person":true,"extra":0}', '```json\n{"person":true}\n```', '{'])('rejects %s', (text) => {
    expect(() => parsePersonResponse(text)).toThrow();
  });
});

describe('watch camera capacity', () => {
  it('caches aggregates for 60 seconds, reserves concurrent bytes, and enforces the cap', async () => {
    let now = 0;
    const aggregate = vi.fn(async () => 80); const warn = vi.fn();
    const capacity = new WatchCameraCapacity({ now: () => now, maxBytes: 100, aggregate, warn });
    expect(await Promise.all([capacity.reserve(10), capacity.reserve(10), capacity.reserve(1)])).toEqual([true, true, false]);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    capacity.release(10);
    expect(await capacity.reserve(10)).toBe(true);
    now = 60_000; aggregate.mockResolvedValue(100);
    expect(await capacity.reserve(1)).toBe(false);
    expect(aggregate).toHaveBeenCalledTimes(2);
    now = 3600_000;
    expect(await capacity.reserve(1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
