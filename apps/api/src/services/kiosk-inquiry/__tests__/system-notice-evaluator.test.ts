import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ statuses: vi.fn(), device: vi.fn(), deliver: vi.fn(), expire: vi.fn(), resolveUnmonitored: vi.fn(), resolveQuiet: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  clientStatus: { findMany: mocks.statuses }, clientDevice: { findFirst: mocks.device }
} }));
vi.mock('../system-notice.service.js', () => ({ deliverSystemNotice: mocks.deliver, resolveInactiveFileNotices: mocks.expire, resolveUnmonitoredTerminalNotices: mocks.resolveUnmonitored, resolveQuietKioskUiErrorNotices: mocks.resolveQuiet }));
import { evaluateSystemNotices, getSystemNoticeEvaluator, TERMINAL_INACTIVE_MS, TERMINAL_STALE_MS } from '../system-notice-evaluator.js';
const now = new Date('2026-10-13T00:00:00Z');
const status = { clientId: 'raspi4-stone', lastSeen: now, diskUsage: 30, temperature: 40 };
afterEach(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', '');
  vi.stubEnv('CLIENT_HEARTBEAT_ALERT_ENABLED', 'false');
  vi.resetAllMocks(); mocks.statuses.mockResolvedValue([status]);
  mocks.device.mockResolvedValue({ name: '端末', location: 'StoneBase01' });
});
describe('system notice evaluator', () => {
  it('resolves quiet kiosk errors on each evaluation', async () => {
    await evaluateSystemNotices(now);
    expect(mocks.resolveQuiet).toHaveBeenCalledWith(now);
  });
  it('logs quiet resolution failures and continues other evaluations', async () => {
    const err = new Error('unavailable');
    mocks.resolveQuiet.mockRejectedValueOnce(err);
    await evaluateSystemNotices(now);
    expect(mocks.warn).toHaveBeenCalledWith({ err }, '[SystemNotice] Quiet kiosk UI error resolution failed');
    expect(mocks.resolveUnmonitored).toHaveBeenCalled();
    expect(mocks.deliver).toHaveBeenCalled();
    expect(mocks.expire).toHaveBeenCalledWith(now);
  });
  it.each(['mac-kiosk-1', 'zero2w-home'])('skips non-monitored client %s', async (clientId) => {
    mocks.statuses.mockResolvedValue([{ ...status, clientId, lastSeen: new Date(now.getTime() - TERMINAL_STALE_MS), diskUsage: 95 }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.resolveUnmonitored).toHaveBeenCalledWith(now, expect.any(Object));
  });
  it('uses the configured heartbeat client-id pattern', async () => {
    vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', '^custom-');
    mocks.statuses.mockResolvedValue([{ ...status, clientId: 'custom-terminal', diskUsage: 95 }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'status:custom-terminal:disk', state: 'open' }), now);
  });
  it.each([TERMINAL_STALE_MS - 1, TERMINAL_STALE_MS])('stale boundary %i', async (age) => {
    mocks.statuses.mockResolvedValue([{ ...status, lastSeen: new Date(now.getTime() - age) }]);
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'status:raspi4-stone:stale',
      title: 'StoneBase01 通信', state: age >= TERMINAL_STALE_MS ? 'open' : 'recovered' }), now);
  });
  it.each([{ diskUsage: 89.9, temperature: 79.9, state: 'recovered' }, { diskUsage: 90, temperature: 80, state: 'open' }])(
    'disk and temperature thresholds $state', async ({ diskUsage, temperature, state }) => {
      mocks.statuses.mockResolvedValue([{ ...status, diskUsage, temperature }]);
      await evaluateSystemNotices(now);
      for (const signal of ['disk', 'temperature']) expect(mocks.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ key: `status:raspi4-stone:${signal}`, state }), now);
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
    mocks.statuses.mockResolvedValue([status, { ...status, clientId: 'raspi4-second' }]);
    mocks.deliver.mockRejectedValueOnce(new Error('unavailable'));
    await evaluateSystemNotices(now);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ key: 'status:raspi4-second:stale' }), now);
  });
  it('does not start timers in tests', async () => {
    const timer = vi.spyOn(global, 'setInterval');
    getSystemNoticeEvaluator().start();
    expect(timer).not.toHaveBeenCalled();
    await getSystemNoticeEvaluator().stop(); timer.mockRestore();
  });
});
