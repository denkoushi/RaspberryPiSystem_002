export class PlanningBoardWriteBlockedError extends Error {
  constructor() { super('圏外のため操作できません'); }
}
export interface PlanningBoardWriteGate {
  canWrite(): boolean;
  assertCanWrite(): void;
  attempt(): boolean;
  generation(): number;
  run<T>(operation: () => Promise<T>): Promise<T>;
  waitForIdle(signal: AbortSignal): Promise<void>;
  subscribeReadOnly(listener: () => void): () => void;
  close(): void;
}
export function createPlanningBoardWriteGate(
  canWrite: () => boolean, generation: () => number, rejected: () => void
): PlanningBoardWriteGate {
  const pending = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  const gate: PlanningBoardWriteGate = {
    canWrite, generation,
    assertCanWrite() { if (!canWrite()) { rejected(); throw new PlanningBoardWriteBlockedError(); } },
    attempt() { if (canWrite()) return true; rejected(); return false; },
    async run(operation) {
      gate.assertCanWrite();
      const started = generation();
      const promise = operation();
      pending.add(promise);
      try {
        const result = await promise;
        if (started !== generation()) throw new PlanningBoardWriteBlockedError();
        return result;
      } finally { pending.delete(promise); }
    },
    async waitForIdle(signal) {
      if (signal.aborted) throw new PlanningBoardWriteBlockedError();
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new PlanningBoardWriteBlockedError());
        signal.addEventListener('abort', abort, { once: true });
        void Promise.allSettled([...pending]).then(() => {
          signal.removeEventListener('abort', abort);
          if (signal.aborted) reject(new PlanningBoardWriteBlockedError()); else resolve();
        });
      });
    },
    subscribeReadOnly(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.forEach((listener) => listener()); }
  };
  return gate;
}
export const passThroughPlanningBoardWriteGate = createPlanningBoardWriteGate(() => true, () => 0, () => undefined);
