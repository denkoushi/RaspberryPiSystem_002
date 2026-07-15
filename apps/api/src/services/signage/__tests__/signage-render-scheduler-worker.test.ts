import { EventEmitter } from 'node:events';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  fork: forkMock,
}));

const originalRunner = process.env.SIGNAGE_RENDER_RUNNER;

class FakeWorker extends EventEmitter {
  readonly pid: number | undefined;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(
    pid: number | null = 4242,
    private readonly exitOnKill = true
  ) {
    super();
    this.pid = pid === null ? undefined : pid;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true;
    this.signalCode = signal;
    if (this.exitOnKill) queueMicrotask(() => this.finishExit(null, signal));
    return true;
  }

  finishExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

describe('SignageRenderScheduler worker readiness', () => {
  let Scheduler: typeof import('../signage-render-scheduler.js').SignageRenderScheduler;
  let readyMessage: string;
  let worker: FakeWorker;

  beforeAll(async () => {
    process.env.SIGNAGE_RENDER_RUNNER = 'worker';
    vi.resetModules();
    const module = await import('../signage-render-scheduler.js');
    Scheduler = module.SignageRenderScheduler;
    readyMessage = module.SIGNAGE_RENDER_WORKER_READY;
  });

  beforeEach(() => {
    forkMock.mockReset();
    worker = new FakeWorker();
    forkMock.mockReturnValue(worker);
  });

  afterAll(() => {
    if (originalRunner === undefined) delete process.env.SIGNAGE_RENDER_RUNNER;
    else process.env.SIGNAGE_RENDER_RUNNER = originalRunner;
    vi.resetModules();
  });

  it('waits for the worker readiness message and then stops the worker cleanly', async () => {
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);
    let resumed = false;

    const resume = scheduler.resumeAfterDeploy(1_000).then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(forkMock).toHaveBeenCalledOnce();
    expect(forkMock.mock.calls[0]?.[2]).toMatchObject({
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    worker.emit('message', { type: readyMessage });
    await resume;
    expect(resumed).toBe(true);
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.pauseForDeploy(1_000);
    expect(worker.killed).toBe(true);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('rejects resume when the worker exits before readiness', async () => {
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);
    const resume = scheduler.resumeAfterDeploy(1_000);
    await Promise.resolve();
    expect(forkMock).toHaveBeenCalledOnce();

    worker.finishExit(1, null);

    await expect(resume).rejects.toThrow('exited before readiness');
    expect(scheduler.isRunning()).toBe(false);
  });

  it('settles a spawn error even when no exit event follows', async () => {
    worker = new FakeWorker(null, false);
    forkMock.mockReturnValue(worker);
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);
    const resume = scheduler.resumeAfterDeploy(1_000);
    await Promise.resolve();

    worker.emit('error', new Error('spawn ENOENT'));

    await expect(resume).rejects.toThrow('spawn ENOENT');
    expect(scheduler.isRunning()).toBe(false);
    await expect(scheduler.pauseForDeploy(50)).resolves.toBeUndefined();
  });

  it('reports ambiguous ownership when readiness fails and the worker cannot be stopped', async () => {
    worker = new FakeWorker(4242, false);
    forkMock.mockReturnValue(worker);
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);

    const resume = scheduler.resumeAfterDeploy(20);

    await expect(resume).rejects.toMatchObject({
      name: 'SchedulerStepStateAmbiguousError',
      stepName: 'signage-render',
      causeErrors: [
        expect.objectContaining({ message: 'Timed out waiting for signage worker readiness' }),
        expect.objectContaining({ message: 'Timed out waiting for signage worker to stop' }),
      ],
    });
    worker.finishExit(null, 'SIGTERM');
  });

  it('does not start a replacement worker until a concurrent pause has quiesced the old one', async () => {
    const firstWorker = new FakeWorker(4242, false);
    const secondWorker = new FakeWorker(4343);
    forkMock.mockReset();
    forkMock.mockReturnValueOnce(firstWorker).mockReturnValueOnce(secondWorker);
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);

    const initialResume = scheduler.resumeAfterDeploy(1_000);
    await Promise.resolve();
    firstWorker.emit('message', { type: readyMessage });
    await initialResume;

    const pause = scheduler.pauseForDeploy(1_000);
    const concurrentResume = scheduler.resumeAfterDeploy(1_000);
    await vi.waitFor(() => expect(firstWorker.killed).toBe(true));
    expect(forkMock).toHaveBeenCalledTimes(1);

    firstWorker.finishExit(null, 'SIGTERM');
    await pause;
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondWorker.emit('message', { type: readyMessage });
    await concurrentResume;
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.pauseForDeploy(1_000);
  });

  it('treats a duplicate resume as idempotent without replacing a ready worker', async () => {
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);
    const firstResume = scheduler.resumeAfterDeploy(1_000);
    await Promise.resolve();
    worker.emit('message', { type: readyMessage });
    await firstResume;

    await scheduler.resumeAfterDeploy(1_000);

    expect(forkMock).toHaveBeenCalledOnce();
    expect(worker.killed).toBe(false);
    await scheduler.pauseForDeploy(1_000);
  });

  it('keeps an error observer after readiness', async () => {
    const scheduler = new Scheduler({ renderCurrentContent: vi.fn() } as never, 30);
    const resume = scheduler.resumeAfterDeploy(1_000);
    await Promise.resolve();
    worker.emit('message', { type: readyMessage });
    await resume;

    expect(() => worker.emit('error', new Error('late worker error'))).not.toThrow();
    await scheduler.pauseForDeploy(1_000);
  });
});
