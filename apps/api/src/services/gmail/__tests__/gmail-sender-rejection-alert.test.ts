import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { notifyGmailSenderRejected } from '../gmail-sender-rejection-alert.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { alert: { findFirst: vi.fn(), create: vi.fn() } } }));
vi.mock('../../alerts/alerts-config.js', () => ({
  loadAlertsDispatcherConfig: vi.fn().mockResolvedValue({ routing: {} }),
  resolveRouteKey: vi.fn().mockReturnValue('ops'),
}));

const now = new Date('2026-11-09T12:00:00Z');
const fingerprint = 'gmail-sender-rejected:rejected:example.com';
type StoredAlert = { fingerprint: string; timestamp: Date; acknowledged: boolean };
let alerts: StoredAlert[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  alerts = [];
  vi.mocked(prisma.alert.findFirst).mockImplementation(async ({ where } = {}) => {
    const cutoff = (where?.timestamp as { gte: Date }).gte;
    return (alerts.find((alert) => alert.fingerprint === where?.fingerprint
      && alert.acknowledged === where?.acknowledged && alert.timestamp >= cutoff) ?? null) as never;
  });
  vi.mocked(prisma.alert.create).mockImplementation(async ({ data }) => {
    alerts.push(data as StoredAlert);
    return data as never;
  });
});
afterEach(() => vi.useRealTimers());

describe('notifyGmailSenderRejected', () => {
  it('suppresses the same unacknowledged alert within 24 hours even if the count changes', async () => {
    await notifyGmailSenderRejected(1, ['example.com'], false);
    await notifyGmailSenderRejected(5, ['example.com'], false);
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    expect(prisma.alert.findFirst).toHaveBeenLastCalledWith({ where: {
      fingerprint, acknowledged: false, timestamp: { gte: new Date('2026-11-08T12:00:00Z') },
    } });
  });

  it.each([
    ['absent', null],
    ['older than 24 hours', { fingerprint, acknowledged: false, timestamp: new Date('2026-11-08T11:59:59Z') }],
    ['acknowledged', { fingerprint, acknowledged: true, timestamp: now }],
    ['different fingerprint', { fingerprint: 'gmail-sender-rejected:rejected:other.com', acknowledged: false, timestamp: now }],
  ] as const)('creates one alert when the existing alert is %s', async (_name, existing) => {
    if (existing) alerts.push(existing);
    await notifyGmailSenderRejected(2, ['example.com'], false);
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    expect(prisma.alert.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fingerprint, timestamp: now, acknowledged: false }) });
  });

  it('suppresses repeated empty-policy alerts', async () => {
    await notifyGmailSenderRejected(0, [], true);
    await notifyGmailSenderRejected(0, [], true);
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    expect(alerts[0].fingerprint).toBe('gmail-sender-rejected:empty:');
  });

  it.each(['findFirst', 'create'] as const)('does not throw if alert %s fails', async (operation) => {
    vi.mocked(prisma.alert[operation]).mockRejectedValueOnce(new Error('unavailable'));
    await expect(notifyGmailSenderRejected(1, ['example.com'], false)).resolves.toBeUndefined();
    if (operation === 'findFirst') expect(prisma.alert.create).not.toHaveBeenCalled();
  });
});
