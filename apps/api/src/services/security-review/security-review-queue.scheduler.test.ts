import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tick: vi.fn<(signal: AbortSignal) => Promise<void>>(), create: vi.fn(), runtime: vi.fn(),
  schedule: vi.fn(), stop: vi.fn(), error: vi.fn(), completion: { complete: vi.fn() },
  env: { SECURITY_REVIEW_QUEUE_ENABLED: 'true', SECURITY_REVIEW_DATA_DIR: '/synthetic-private-directory',
    SECURITY_REVIEW_QUEUE_CRON: '*/10 * * * *', SECURITY_REVIEW_QUEUE_QUIET: '05:50-07:00' },
}));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/logger.js', () => ({ logger: { error: mocks.error } }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: mocks.runtime }));
vi.mock('./security-review-queue.service.js', () => ({
  SecurityReviewQueueService: class {
    constructor(deps: unknown) { mocks.create(deps); }
    tick(signal: AbortSignal) { return mocks.tick(signal); }
  },
}));

import { SecurityReviewQueueScheduler } from './security-review-queue.scheduler.js';

beforeEach(() => {
  mocks.env.SECURITY_REVIEW_QUEUE_ENABLED = 'true';
  mocks.schedule.mockReturnValue({ stop: mocks.stop });
  mocks.runtime.mockReturnValue({ createTextCompletionPort: () => mocks.completion });
  mocks.tick.mockResolvedValue();
});
afterEach(() => { vi.resetAllMocks(); });

describe('lease-owned commit review queue scheduler', () => {
  it('does not schedule or initialize inference while disabled', async () => {
    mocks.env.SECURITY_REVIEW_QUEUE_ENABLED = 'false';
    const scheduler = new SecurityReviewQueueScheduler();
    scheduler.start(); await scheduler.stop();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('uses the configured Tokyo cron, initializes lazily and reuses the service', async () => {
    const scheduler = new SecurityReviewQueueScheduler();
    scheduler.start(); scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('*/10 * * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    expect(mocks.runtime).not.toHaveBeenCalled();
    mocks.schedule.mock.calls[0]![1]();
    await scheduler.stop();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ dataDir: '/synthetic-private-directory', quiet: '05:50-07:00', completion: mocks.completion });
    expect(mocks.tick).toHaveBeenCalledTimes(1);
    scheduler.start();
    mocks.schedule.mock.calls[1]![1]();
    await scheduler.stop();
    expect(mocks.tick).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.runtime).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping ticks and aborts and awaits the active tick on lease loss', async () => {
    let signal: AbortSignal | undefined;
    mocks.tick.mockImplementation(value => new Promise(resolve => {
      signal = value;
      value.addEventListener('abort', () => resolve(), { once: true });
    }));
    const scheduler = new SecurityReviewQueueScheduler(); scheduler.start();
    const tick = mocks.schedule.mock.calls[0]![1];
    tick(); tick();
    await vi.waitFor(() => expect(mocks.tick).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);
    await scheduler.stop();
    expect(signal?.aborted).toBe(true);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('records a failed tick and allows later scheduled work', async () => {
    mocks.tick.mockRejectedValueOnce(new TypeError('synthetic queue storage failure'));
    const scheduler = new SecurityReviewQueueScheduler(); scheduler.start();
    mocks.schedule.mock.calls[0]![1]();
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith({ error: 'TypeError', message: 'synthetic queue storage failure' }, 'Security review queue failed'));
    mocks.schedule.mock.calls[0]![1]();
    await scheduler.stop();
    expect(mocks.tick).toHaveBeenCalledTimes(2);
  });
});
