import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ statuses: vi.fn(), device: vi.fn(), deliver: vi.fn(), expire: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  clientStatus: { findMany: mocks.statuses }, clientDevice: { findFirst: mocks.device }
} }));
vi.mock('../system-notice.service.js', () => ({ deliverSystemNotice: mocks.deliver, resolveInactiveFileNotices: mocks.expire }));
import { evaluateSystemNotices, getSystemNoticeEvaluator, TERMINAL_INACTIVE_MS, TERMINAL_STALE_MS } from '../system-notice-evaluator.js';
const now = new Date('2026-10-13T00:00:00Z');
const status = { clientId: 'stone', lastSeen: now, diskUsage: 30, temperature: 40 };
beforeEach(() => {
  vi.resetAllMocks(); mocks.statuses.mockResolvedValue([status]);
  mocks.device.mockResolvedValue({ name: '端末', location: 'StoneBase01' });
});
describe('system notice evaluator', () => {
  it.each([TERMINAL_STALE_MS - 1, TERMINAL_STALE_MS])('stale boundary %i', async (age) => {
    mocks.statuses.mockResolvedValue([{ ...status, lastSeen: new Date(now.getTime() - age) }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'status:stone:stale',
      title: 'StoneBase01 通信', state: age >= TERMINAL_STALE_MS ? 'open' : 'recovered' }), now);
  });
  it.each([{ diskUsage: 89.9, temperature: 79.9, state: 'recovered' }, { diskUsage: 90, temperature: 80, state: 'open' }])(
    'disk and temperature thresholds $state', async ({ diskUsage, temperature, state }) => {
      mocks.statuses.mockResolvedValue([{ ...status, diskUsage, temperature }]);
      await evaluateSystemNotices(now);
      for (const signal of ['disk', 'temperature']) expect(mocks.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ key: `status:stone:${signal}`, state }), now);
    });
  it('skips terminals unseen for 14 days and expires file notices', async () => {
    mocks.statuses.mockResolvedValue([{ ...status, lastSeen: new Date(now.getTime() - TERMINAL_INACTIVE_MS) }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.expire).toHaveBeenCalledWith(now);
  });
  it('recovers conditions on the next healthy report and ignores unknown temperature', async () => {
    mocks.statuses.mockResolvedValueOnce([{ ...status, lastSeen: new Date(now.getTime() - TERMINAL_STALE_MS), diskUsage: 95, temperature: 85 }]);
    await evaluateSystemNotices(now);
    mocks.deliver.mockClear();
    await evaluateSystemNotices(now);
    expect(mocks.deliver.mock.calls.map(([notice]) => notice.state)).toEqual(['recovered', 'recovered', 'recovered']);
    mocks.deliver.mockClear(); mocks.statuses.mockResolvedValue([{ ...status, temperature: null }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
  });
  it('continues evaluating other terminals after delivery failure', async () => {
    mocks.statuses.mockResolvedValue([status, { ...status, clientId: 'second' }]);
    mocks.deliver.mockRejectedValueOnce(new Error('unavailable'));
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'status:second:stale' }), now);
  });
  it('does not start timers in tests', async () => {
    const timer = vi.spyOn(global, 'setInterval');
    getSystemNoticeEvaluator().start();
    expect(timer).not.toHaveBeenCalled();
    await getSystemNoticeEvaluator().stop(); timer.mockRestore();
  });
});
