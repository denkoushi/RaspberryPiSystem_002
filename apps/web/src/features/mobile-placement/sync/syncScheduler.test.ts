import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSyncJob, requestSync, resetSyncSchedulerForTests, runSyncOperation, start, stop } from './syncScheduler';

const gate = vi.hoisted(() => ({ allowed: true, listeners: new Set<() => void>() }));
vi.mock('./networkGate', () => ({
  canSyncNow: () => gate.allowed,
  subscribeCanSync: (listener: () => void) => { gate.listeners.add(listener); return () => gate.listeners.delete(listener); }
}));
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
beforeEach(() => { vi.useFakeTimers(); gate.allowed = true; });
afterEach(() => { resetSyncSchedulerForTests(); vi.useRealTimers(); });

describe('syncScheduler', () => {
  it('does nothing while forbidden and runs once on false -> true', async () => {
    gate.allowed = false;
    const run = vi.fn().mockResolvedValue(undefined);
    registerSyncJob({ name: 'job', run }); start(); requestSync('submit'); await settle();
    expect(run).not.toHaveBeenCalled();
    gate.allowed = true; gate.listeners.forEach((listener) => listener()); await settle();
    expect(run).toHaveBeenCalledTimes(1);
    gate.listeners.forEach((listener) => listener()); await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('serializes jobs and coalesces requests during a run into one additional pass', async () => {
    let finish!: () => void;
    const first = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    registerSyncJob({ name: 'first', run: first }); registerSyncJob({ name: 'second', run: second });
    start(); await settle();
    requestSync('one'); requestSync('two'); requestSync('three'); await settle();
    expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
    finish(); await settle();
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
    expect(second.mock.invocationCallOrder[0]).toBeLessThan(first.mock.invocationCallOrder[1]);
  });
  it('serializes submissions with scheduled jobs', async () => {
    let finish!: () => void;
    const run = vi.fn().mockResolvedValue(undefined);
    const submission = runSyncOperation(() => new Promise<void>((resolve) => { finish = resolve; }));
    registerSyncJob({ name: 'job', run }); start(); await settle();
    expect(run).not.toHaveBeenCalled();
    finish(); await submission; await settle();
    expect(run).toHaveBeenCalledOnce();
  });
  it('continues after a job fails', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerSyncJob({ name: 'fail', run: async () => { throw new Error('failed'); } });
    registerSyncJob({ name: 'next', run }); start(); await settle(); expect(run).toHaveBeenCalledOnce();
  });
  it.each([[true, 30_000], [false, 30 * 60_000]] as const)('uses pending=%s interval %s and stops timers', async (pending, interval) => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerSyncJob({ name: 'job', run, hasPendingWork: async () => pending });
    start(); start(); await settle(); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(interval - 1); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(interval); expect(run).toHaveBeenCalledTimes(2);
  });
  it('runs on becoming visible and unregisters jobs', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const unregister = registerSyncJob({ name: 'job', run }); start(); await settle();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(run).toHaveBeenCalledTimes(2);
    unregister(); requestSync('manual'); await settle(); expect(run).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it('does not overlap an in-flight job across stop/start', async () => {
    let finish!: () => void;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    registerSyncJob({ name: 'job', run }); start(); await settle();
    stop(); start(); await settle(); expect(run).toHaveBeenCalledTimes(1);
    finish(); await settle(); expect(run).toHaveBeenCalledTimes(2);
  });
});
