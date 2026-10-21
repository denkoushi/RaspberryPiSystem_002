import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(), run: vi.fn(), stop: vi.fn(),
  env: { NODE_ENV: 'development', ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED: 'true' }
}));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../procedure-term-learning.service.js', () => ({ runProcedureTermLearningOnce: mocks.run }));
import { ProcedureTermLearningScheduler, getProcedureTermLearningScheduler } from '../procedure-term-learning.scheduler.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.NODE_ENV = 'development';
  mocks.env.ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED = 'true';
  mocks.schedule.mockReturnValue({ stop: mocks.stop });
});

describe('procedure term learning scheduler', () => {
  it('uses a singleton, checks flags at start and never schedules in tests', async () => {
    expect(getProcedureTermLearningScheduler()).toBe(getProcedureTermLearningScheduler());
    const scheduler = new ProcedureTermLearningScheduler();
    mocks.env.NODE_ENV = 'test';
    scheduler.start();
    mocks.env.NODE_ENV = 'development';
    mocks.env.ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED = 'false';
    scheduler.start();
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.env.ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED = 'true';
    scheduler.start(); scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('30 4 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    await scheduler.stop();
  });
  it('prevents overlapping runs and aborts and awaits active work on stop', async () => {
    let finish!: (value: unknown[]) => void;
    mocks.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const scheduler = new ProcedureTermLearningScheduler();
    scheduler.start();
    const tick = mocks.schedule.mock.calls[0][1];
    tick(); tick();
    expect(mocks.run).toHaveBeenCalledOnce();
    const signal = mocks.run.mock.calls[0][0].signal;
    let stopped = false;
    const stop = scheduler.stop().then(() => { stopped = true; });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish([]);
    await stop;
    expect(mocks.stop).toHaveBeenCalledOnce();
    scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
  it('contains job failure and permits the following run', async () => {
    mocks.run.mockRejectedValue(new Error('failed'));
    const scheduler = new ProcedureTermLearningScheduler();
    scheduler.start();
    const tick = mocks.schedule.mock.calls[0][1];
    tick();
    await scheduler.stop();
    scheduler.start();
    tick();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
