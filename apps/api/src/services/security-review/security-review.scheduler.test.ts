import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn(), schedule: vi.fn(), stop: vi.fn(), env: {
  SECURITY_REVIEW_NIGHTLY_ENABLED: 'true', SECURITY_REVIEW_DATA_DIR: '/fixture', SECURITY_REVIEW_NIGHTLY_CRON: '0 6 * * *', SECURITY_REVIEW_RETRY_UNTIL: '06:55',
} }));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./security-review.service.js', () => ({ RUN_TIMEOUT_MS: 50 * 60_000, createSecurityReviewService: mocks.create }));
import { SecurityReviewScheduler } from './security-review.scheduler.js';
import { logger } from '../../lib/logger.js';
afterEach(() => { vi.clearAllMocks(); mocks.env.SECURITY_REVIEW_NIGHTLY_ENABLED = 'true'; });

describe('Lease-owned security review scheduler', () => {
  it('uses configured Tokyo schedule, prevents overlap and aborts on lease loss', async () => {
    mocks.schedule.mockReturnValue({ stop: mocks.stop });
    mocks.create.mockResolvedValue({ run: mocks.run });
    let stopped: AbortSignal | undefined;
    mocks.run.mockImplementation((signal: AbortSignal) => new Promise(resolve => {
      stopped = signal; signal.addEventListener('abort', () => resolve({ status: 'skipped' }), { once: true });
    }));
    const scheduler = new SecurityReviewScheduler(); scheduler.start(); scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledWith('0 6 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    const tick = mocks.schedule.mock.calls[0]![1]; tick(); tick();
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    await scheduler.stop();
    expect(stopped?.aborted).toBe(true);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
  it('does nothing while disabled', () => {
    mocks.env.SECURITY_REVIEW_NIGHTLY_ENABLED = 'false'; new SecurityReviewScheduler().start();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('logs the error name and message when a run fails', async () => {
    mocks.schedule.mockReturnValue({ stop: mocks.stop });
    mocks.create.mockResolvedValue({ run: mocks.run });
    mocks.run.mockRejectedValueOnce(new TypeError('fixture storage failure'));
    const scheduler = new SecurityReviewScheduler(); scheduler.start();
    mocks.schedule.mock.calls[0]![1]();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith(
      { error: 'TypeError', message: 'fixture storage failure' }, 'Security review failed'));
    await scheduler.stop();
  });
});
