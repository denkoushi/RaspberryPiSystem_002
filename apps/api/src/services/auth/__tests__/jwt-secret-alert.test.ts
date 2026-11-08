import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { alert: { findFirst: mocks.findFirst, create: mocks.create } } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../alerts/alerts-config.js', () => ({ loadAlertsDispatcherConfig: async () => ({ routing: {} }), resolveRouteKey: () => 'ops' }));
import { notifySharedJwtSecret } from '../jwt-secret-alert.js';
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z')); mocks.findFirst.mockResolvedValue(null); });
afterEach(() => vi.useRealTimers());
describe('shared JWT key alert delivery', () => {
  it('queues a warning through the existing alert dispatcher', async () => {
    mocks.create.mockResolvedValue({});
    await notifySharedJwtSecret();
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'auth-shared-jwt-secret', severity: 'WARNING', deliveries: { create: { channel: 'SLACK', routeKey: 'ops', status: 'PENDING', attemptCount: 0 } } }) });
  });
  it('skips an existing warning within the last 24 hours', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'existing' });
    await notifySharedJwtSecret();
    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { type: 'auth-shared-jwt-secret', timestamp: { gte: new Date('2026-11-07T12:00:00Z') } },
      select: { id: true }
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps startup running if the duplicate lookup fails', async () => {
    mocks.findFirst.mockRejectedValue(new Error('storage failure'));
    await expect(notifySharedJwtSecret()).resolves.toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });
  it('keeps startup running even if notification storage fails', async () => {
    mocks.create.mockRejectedValue(new Error('storage failure'));
    await expect(notifySharedJwtSecret()).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalled();
  });
});
