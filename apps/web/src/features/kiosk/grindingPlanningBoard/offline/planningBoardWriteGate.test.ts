import { describe, expect, it, vi } from 'vitest';

import { createPlanningBoardWriteGate, PlanningBoardWriteBlockedError } from './planningBoardWriteGate';

describe('planning board write gate', () => {
  it('checks its synchronous source before enqueue and send and emits the rejection notification', async () => {
    let online = true; const rejected = vi.fn(); const send = vi.fn().mockResolvedValue('saved');
    const gate = createPlanningBoardWriteGate(() => online, () => 0, rejected);
    expect(gate.attempt()).toBe(true); online = false;
    expect(gate.attempt()).toBe(false); expect(() => gate.assertCanWrite()).toThrow(PlanningBoardWriteBlockedError);
    await expect(gate.run(send)).rejects.toBeInstanceOf(PlanningBoardWriteBlockedError);
    expect(send).not.toHaveBeenCalled(); expect(rejected).toHaveBeenCalledTimes(3);
  });
  it('rejects the response of an old generation and waits for the already-sent request to settle', async () => {
    let generation = 0; let finish!: (value: string) => void;
    const gate = createPlanningBoardWriteGate(() => true, () => generation, vi.fn());
    const save = gate.run(() => new Promise<string>((resolve) => { finish = resolve; }));
    const rejection = expect(save).rejects.toBeInstanceOf(PlanningBoardWriteBlockedError);
    const idle = vi.fn(); const waiting = gate.waitForIdle(new AbortController().signal).then(idle);
    generation++; await Promise.resolve(); expect(idle).not.toHaveBeenCalled();
    finish('old'); await rejection; await waiting; expect(idle).toHaveBeenCalledOnce();
  });
  it('allows a recovery deadline to abort waiting without retransmitting a pending write', async () => {
    let finish!: () => void; const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const gate = createPlanningBoardWriteGate(() => true, () => 0, vi.fn());
    const saving = gate.run(send); const abort = new AbortController();
    const wait = gate.waitForIdle(abort.signal); abort.abort();
    await expect(wait).rejects.toBeInstanceOf(PlanningBoardWriteBlockedError);
    expect(send).toHaveBeenCalledOnce(); finish(); await saving;
  });
  it('notifies subscribers synchronously when the read-only generation begins', () => {
    const gate = createPlanningBoardWriteGate(() => false, () => 1, vi.fn());
    const cancel = vi.fn(); const unsubscribe = gate.subscribeReadOnly(cancel);
    gate.close(); expect(cancel).toHaveBeenCalledOnce(); unsubscribe(); gate.close(); expect(cancel).toHaveBeenCalledOnce();
  });
});
