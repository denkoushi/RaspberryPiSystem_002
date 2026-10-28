import { canSyncNow, subscribeCanSync } from './networkGate';

type SyncJob = { name: string; run: () => Promise<unknown>; hasPendingWork?: () => boolean | Promise<boolean> };
const jobs = new Map<string, SyncJob>();
const listeners = new Set<() => void>();
let started = false;
let running: Promise<void> | undefined;
let requested = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
let timerVersion = 0;
let serial = Promise.resolve();

// A submit that returns its send result must share the scheduler's execution lane.
export function runSyncOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.then(operation);
  serial = result.then(() => undefined, () => undefined);
  return result;
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function scheduleNext() {
  const version = ++timerVersion;
  clearTimeout(timer);
  const pending = await Promise.all([...jobs.values()].map(async (job) => {
    try { return await job.hasPendingWork?.() ?? false; } catch { return false; }
  }));
  if (!started || version !== timerVersion) return;
  timer = setTimeout(() => requestSync('timer'), pending.some(Boolean) ? 30_000 : 30 * 60_000);
}

export function registerSyncJob(job: SyncJob) {
  jobs.set(job.name, job);
  if (started) requestSync('register');
  return () => { if (jobs.get(job.name) === job) jobs.delete(job.name); };
}

export function requestSync(_reason: string) {
  if (!started) return;
  if (!canSyncNow()) { void scheduleNext(); return; }
  requested = true;
  if (running) return;
  clearTimeout(timer);
  ++timerVersion;
  running = Promise.resolve().then(async () => {
    while (started && requested && canSyncNow()) {
      requested = false;
      for (const job of [...jobs.values()]) {
        if (!started || !canSyncNow()) break;
        if (jobs.get(job.name) !== job) continue;
        try {
          await runSyncOperation(() => started && canSyncNow() && jobs.get(job.name) === job ? job.run() : Promise.resolve());
        } catch { /* A job owns its retry/backoff policy. */ }
        listeners.forEach((listener) => listener());
      }
    }
  }).finally(() => {
    running = undefined;
    void scheduleNext();
  });
}

const onVisibility = () => { if (document.visibilityState === 'visible') requestSync('visible'); };
export function start() {
  if (started) return;
  started = true;
  let previous = canSyncNow();
  unsubscribe = subscribeCanSync(() => {
    const next = canSyncNow();
    if (next && !previous) requestSync('network');
    previous = next;
  });
  document.addEventListener('visibilitychange', onVisibility);
  requestSync('start');
}

export function stop() {
  started = false;
  requested = false;
  ++timerVersion;
  clearTimeout(timer);
  unsubscribe?.();
  unsubscribe = undefined;
  document.removeEventListener('visibilitychange', onVisibility);
}

export function resetSyncSchedulerForTests() {
  stop();
  jobs.clear();
  listeners.clear();
}
