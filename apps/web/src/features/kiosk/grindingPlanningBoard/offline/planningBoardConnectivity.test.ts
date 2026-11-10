import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanningBoardConnectivity } from './planningBoardConnectivity';
import { readPlanningBoardOfflineConfig } from './planningBoardOfflineConfig';

const config = readPlanningBoardOfflineConfig({});
type Controller = ReturnType<typeof createPlanningBoardConnectivity>;

describe('planning board connectivity', () => {
  let mono: number;
  let board: Controller;
  let probe: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<boolean>>>;
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const phase = () => board.getSnapshot().phase;
  const generation = () => board.getSnapshot().generation;
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  const start = async () => { board.start(); await flush(); };
  const offline = async () => { await start(); await advance(15000); expect(phase()).toBe('offline'); };
  const successfulProbe = async () => {
    probe.mockResolvedValueOnce(true);
    board.probeNow();
    await flush();
  };
  const online = async () => {
    probe.mockResolvedValue(true);
    await start();
    await advance(5000);
    expect(phase()).toBe('bootstrapping');
    board.reportFullRefresh(generation(), true);
    expect(phase()).toBe('online');
    probe.mockResolvedValue(false);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    mono = 0;
    probe = vi.fn().mockResolvedValue(false);
    board = createPlanningBoardConnectivity({ config, probe, now: () => mono + performance.now() });
  });
  afterEach(() => { board.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('re-arms the loss timer when it fires just before the monotonic deadline', async () => {
    await start();
    mono = -1;
    await advance(15000);
    expect(phase()).toBe('bootstrapping');
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('keeps bootstrapping at 14999ms and becomes offline at 15000ms', async () => {
    await start();
    const initial = board.getSnapshot();
    await advance(14999);
    expect(board.getSnapshot()).toBe(initial);
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('keeps online at 14999ms since its last success and becomes offline at 15000ms', async () => {
    await online();
    const initial = board.getSnapshot();
    await advance(14999);
    expect(board.getSnapshot()).toBe(initial);
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('returns refreshing to offline at its deadline even when the caller never reports', async () => {
    await offline(); await successfulProbe(); await successfulProbe();
    const refreshing = generation(); expect(phase()).toBe('refreshing');
    await advance(14999); expect(phase()).toBe('refreshing');
    await advance(1); expect(phase()).toBe('offline');
    board.reportFullRefresh(refreshing, true); expect(phase()).toBe('offline');
  });

  it('needs two distinct consecutive probes and full refresh before recovery', async () => {
    await offline();
    await successfulProbe();
    expect(phase()).toBe('offline');
    board.reportBoardReadSuccess(generation());
    expect(phase()).toBe('offline');
    await successfulProbe();
    expect(phase()).toBe('refreshing');
    expect(board.getSnapshot().recoveredUntil).toBeNull();
    board.reportFullRefresh(generation(), true);
    expect(phase()).toBe('online');
    expect(board.getSnapshot().recoveredUntil).toBe(mono + performance.now() + 3000);
    await advance(3000);
    expect(board.getSnapshot().recoveredUntil).toBeNull();
    await advance(12000);
    expect(phase()).toBe('offline');
  });

  it('does not recover with success, failure, success', async () => {
    await offline();
    await successfulProbe();
    board.probeNow(); await flush();
    await successfulProbe();
    expect(phase()).toBe('offline');
  });

  it('returns to offline on full-refresh failure and starts the streak again', async () => {
    await offline();
    await successfulProbe(); await successfulProbe();
    board.reportFullRefresh(generation(), false);
    expect(phase()).toBe('offline');
    await successfulProbe();
    expect(phase()).toBe('offline');
  });

  it('keeps a failed startup load under the 15 second rule', async () => {
    board.start(); await flush();
    board.reportFullRefresh(generation(), false);
    expect(phase()).toBe('bootstrapping');
  });

  it('does not show a recovered banner on initial online startup', async () => {
    await online();
    expect(board.getSnapshot().recoveredUntil).toBeNull();
  });

  it('accepts one probe plus a full startup read as independent successes', async () => {
    probe.mockResolvedValue(true);
    await start();
    board.reportFullRefresh(generation(), true);
    expect(phase()).toBe('online');
    expect(board.getSnapshot().recoveredUntil).toBeNull();
  });

  it('waits for a probe when the full startup read finishes first', async () => {
    await start();
    board.reportFullRefresh(generation(), true);
    expect(phase()).toBe('bootstrapping');
    await successfulProbe();
    expect(phase()).toBe('online');
  });

  it('expires bootstrapping at 15 seconds even with successful probes and failed reads', async () => {
    probe.mockResolvedValue(true);
    await start();
    board.reportFullRefresh(generation(), false);
    await advance(14999);
    expect(phase()).toBe('bootstrapping');
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('uses the configured success count', async () => {
    board.stop();
    board = createPlanningBoardConnectivity({ config: { ...config, recoverySuccesses: 3 }, probe, now: () => mono + performance.now() });
    await offline();
    await successfulProbe(); await successfulProbe();
    expect(phase()).toBe('offline');
    await successfulProbe();
    expect(phase()).toBe('refreshing');
  });

  it('ignores large forward and backward Date adjustments', async () => {
    await online();
    vi.setSystemTime(new Date('2099-01-01'));
    await advance(14999);
    expect(phase()).toBe('online');
    vi.setSystemTime(new Date('1970-01-01'));
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('uses performance.now by default, unaffected by Date', async () => {
    board.stop();
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    board = createPlanningBoardConnectivity({ config, probe });
    await start();
    vi.setSystemTime(new Date('2099-01-01'));
    mono = 15000;
    board.probeNow();
    expect(phase()).toBe('offline');
  });

  it('checks elapsed time on an event even when timers have not fired', async () => {
    await online();
    const old = generation();
    mono += 15000;
    board.reportBoardReadSuccess(old);
    expect(phase()).toBe('offline');
    expect(generation()).not.toBe(old);
  });

  it('extends the online deadline with a current-generation board read only', async () => {
    await online();
    await advance(14000);
    board.reportBoardReadSuccess(generation());
    await advance(14999);
    expect(phase()).toBe('online');
    await advance(1);
    expect(phase()).toBe('offline');
  });

  it('ignores old-generation board reads and full-refresh completions', async () => {
    await online();
    const old = generation();
    await advance(15000);
    await successfulProbe(); await successfulProbe();
    board.reportFullRefresh(old, true);
    expect(phase()).toBe('refreshing');
    board.reportFullRefresh(generation(), true);
    await advance(14000);
    board.reportBoardReadSuccess(old);
    await advance(1000);
    expect(phase()).toBe('offline');
  });

  it('aborts a timed-out probe and never counts its late response', async () => {
    await offline();
    let resolve!: (value: boolean) => void;
    probe.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    board.probeNow(); await flush();
    const signal = probe.mock.calls.at(-1)![0];
    await advance(3000);
    expect(signal.aborted).toBe(true);
    resolve(true); await flush();
    await successfulProbe();
    expect(phase()).toBe('offline');
  });

  it('rejects a response at its deadline even if the timeout callback was delayed', async () => {
    await offline();
    let resolve!: (value: boolean) => void;
    probe.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    board.probeNow(); await flush();
    mono += 3000;
    resolve(true); await flush();
    await successfulProbe();
    expect(phase()).toBe('offline');
  });

  it('skips interval and event probes while one is pending; start is idempotent', async () => {
    board.stop();
    board = createPlanningBoardConnectivity({ config: { ...config, probeTimeoutMs: 12000, probeIntervalMs: 5000 }, probe, now: () => mono + performance.now() });
    probe.mockImplementation(() => new Promise<boolean>(() => {}));
    await start(); board.start(); board.probeNow();
    await advance(10000);
    expect(probe).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(probe.mock.calls[0][0].aborted).toBe(true);
    await advance(3000);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('handles synchronous throws and rejected probes as streak-resetting failures', async () => {
    await offline();
    for (const fail of [() => { throw new Error('sync'); }, () => Promise.reject(new Error('async'))]) {
      await successfulProbe();
      probe.mockImplementationOnce(fail);
      board.probeNow(); await flush();
      await successfulProbe();
      expect(phase()).toBe('offline');
      board.probeNow(); await flush();
    }
  });

  it('notifies only on snapshot changes and supports unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = board.subscribe(listener);
    const initial = board.getSnapshot();
    await start();
    expect(board.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    await advance(15000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await successfulProbe(); await successfulProbe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears timers, aborts pending work, and ignores all inputs after stop', async () => {
    let resolve!: (value: boolean) => void;
    probe.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    const listener = vi.fn();
    board.subscribe(listener);
    await start();
    const signal = probe.mock.calls[0][0];
    board.stop(); board.stop();
    const snapshot = board.getSnapshot();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    resolve(true); await flush();
    board.start(); board.probeNow();
    board.reportFullRefresh(generation(), true);
    board.reportBoardReadSuccess(generation());
    await advance(30000);
    expect(board.getSnapshot()).toBe(snapshot);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('can stop before the first probe microtask or before start', async () => {
    board.start(); board.stop(); await flush();
    expect(probe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const unused = createPlanningBoardConnectivity({ config, probe });
    unused.stop(); unused.start();
    expect(vi.getTimerCount()).toBe(0);
  });
});
