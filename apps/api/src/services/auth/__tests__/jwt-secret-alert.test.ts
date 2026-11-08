import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { alert: { create: mocks.create } } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../alerts/alerts-config.js', () => ({ loadAlertsDispatcherConfig: async () => ({ routing: {} }), resolveRouteKey: () => 'ops' }));
import { notifySharedJwtSecret } from '../jwt-secret-alert.js';
beforeEach(() => vi.clearAllMocks());
describe('shared JWT key alert delivery', () => {
  it('queues a warning through the existing alert dispatcher', async () => {
    mocks.create.mockResolvedValue({});
    await notifySharedJwtSecret();
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'auth-shared-jwt-secret', severity: 'WARNING', deliveries: { create: { channel: 'SLACK', routeKey: 'ops', status: 'PENDING', attemptCount: 0 } } }) });
  });
  it('keeps startup running even if notification storage fails', async () => {
    mocks.create.mockRejectedValue(new Error('storage failure'));
    await expect(notifySharedJwtSecret()).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalled();
  });
});
