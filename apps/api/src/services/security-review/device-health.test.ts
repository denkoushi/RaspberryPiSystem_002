import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { queryDeviceHealth, shapeDeviceHealth } from './device-health.js';
import { deviceHealthSchema } from './report-schema.js';

type Rows = Parameters<typeof shapeDeviceHealth>[0];
const since = new Date('2026-10-26T00:00:00.000Z');
const first = '2026-10-26T01:00:00.000Z';
const last = '2026-10-26T02:00:00.000Z';
const old = '2026-10-20T00:00:00.000Z';
const rows = (overrides: Partial<Rows> = {}): Rows => ({ alerts: [], ext4Logs: [], powerLogs: [], devices: [], ...overrides });
const alert = (overrides: Partial<Rows['alerts'][number]> = {}): Rows['alerts'][number] => ({
  type: 'storage-health-ext4_errors_recorded', source: { clientId: 'a' }, details: { signal: 'ext4_errors_recorded' },
  severity: 'WARNING', timestamp: new Date(first), acknowledged: false, acknowledgedAt: null, ...overrides,
});
const log = (clientId = 'a', signal = 'ext4_errors_recorded', raw = '4', time = first): Rows['ext4Logs'][number] => ({
  clientId, context: { category: 'storage_health', signal, raw, observedAt: time }, createdAt: new Date(time),
});
const outage = (overrides: Partial<Rows['alerts'][number]> = {}) => alert({
  type: 'client-heartbeat-stale', source: null, details: { clientId: 'a', lastSeen: old }, ...overrides,
});

describe('Deterministic device health', () => {
  it('prioritizes storage, then power, offline and none', () => {
    const powerLogs = [log('a', 'power_undervoltage_current')];
    const offline = outage();
    expect(shapeDeviceHealth(rows(), since).attention).toBe('none');
    expect(shapeDeviceHealth(rows({ alerts: [offline] }), since).attention).toBe('offline');
    expect(shapeDeviceHealth(rows({ alerts: [offline], powerLogs }), since).attention).toBe('power');
    for (const storage of [alert({ timestamp: new Date(old) }), alert({ acknowledged: true })]) {
      expect(shapeDeviceHealth(rows({ alerts: [offline, storage], powerLogs }), since).attention).toBe('storage');
    }
    expect(shapeDeviceHealth(rows({ alerts: [offline], powerLogs, ext4Logs: [log()] }), since).attention).toBe('storage');
    expect(shapeDeviceHealth(rows({ alerts: [alert({ timestamp: new Date(old), acknowledged: true })] }), since).attention).toBe('none');
  });

  it('separates open and recent episodes and sorts filesystem signals before newer power alerts', () => {
    const ext4 = alert({ timestamp: new Date(old) });
    const filesystem = alert({ type: 'storage-health-root_filesystem_read_only', details: null, timestamp: new Date(first), acknowledged: true });
    const kernel = alert({ details: { signal: 'kernel_storage_error' }, timestamp: new Date(last) });
    const power = alert({ details: { signal: 'power_undervoltage_current' }, timestamp: new Date('2026-10-26T03:00:00.000Z') });
    const result = shapeDeviceHealth(rows({ alerts: [power, ext4, filesystem, kernel] }), since);
    expect(result.storage.open.map(item => item.signal)).toEqual(['kernel_storage_error', 'ext4_errors_recorded', 'power_undervoltage_current']);
    expect(result.storage.last24h.map(item => item.signal)).toEqual(['kernel_storage_error', 'root_filesystem_read_only', 'power_undervoltage_current']);
    expect(result.storage.open[1]).toMatchObject({ clientId: 'a', severity: 'WARNING', timestamp: old });
  });

  it('uses the latest ext4 count per client, parses integer strings and sorts by observation time', () => {
    const result = shapeDeviceHealth(rows({ ext4Logs: [log('a', undefined, '2'), log('b', undefined, ' 12 ', last),
      { ...log('a', undefined, '7', last), context: { raw: '7', observedAt: first } },
      ...['0', '-1', 'NaN', '2x', '1.5', '', '9007199254740992'].map((raw, index) => log(`invalid-${index}`, undefined, raw))] }), since);
    expect(result.ext4Errors).toEqual([
      { clientId: 'b', device: 'b', count: 12, observedAt: last },
      { clientId: 'a', device: 'a', count: 7, observedAt: first },
    ]);
  });

  it('groups power by client and signal with first, last and latest raw', () => {
    const result = shapeDeviceHealth(rows({ powerLogs: [log('a', 'power_undervoltage_current', 'new', last),
      log('a', 'power_undervoltage_current', 'old'), log('a', 'power_throttled_current', 'throttled'),
      log('b', 'power_undervoltage_current', 'other'), log('b', 'power_undervoltage_since_boot', 'boot'),
      log('a', 'power_undervoltage_current', 'stale', old), log(),
      { ...log('c', 'power_undervoltage_current'), context: { category: 'other', signal: 'power_undervoltage_current' } }] }), since);
    expect(result.power).toHaveLength(4);
    expect(result.power[0]).toEqual({ clientId: 'a', device: 'a', signal: 'power_undervoltage_current', count: 2, first, last, raw: 'new' });
    expect(result.power.slice(1).every(item => item.count === 1)).toBe(true);
  });

  it('retains old open outages and records recovered and still-silent endpoints', () => {
    const result = shapeDeviceHealth(rows({ alerts: [outage({ timestamp: new Date(old) }),
      outage({ acknowledged: true, acknowledgedAt: new Date(last) }),
      outage({ timestamp: new Date(old), acknowledged: true, acknowledgedAt: new Date(first) })] }), since);
    expect(result.offline).toEqual([
      { clientId: 'a', device: 'a', lastSeen: old, detectedAt: first, endedAt: last },
      { clientId: 'a', device: 'a', lastSeen: old, detectedAt: old, endedAt: null },
    ]);
  });

  it('uses the lowest device id, trimmed location, name with client id and bare client id', () => {
    const result = shapeDeviceHealth(rows({ alerts: [alert({ source: { clientId: 'a' }, details: { clientId: 'ignored' } }),
      alert({ source: null, details: { clientId: 'b' } }), alert({ source: null, details: { clientId: 'c' } }),
      alert({ source: { clientId: 'd' } })], devices: [
      { id: '2', statusClientId: 'a', name: 'Wrong', location: 'Wrong' },
      { id: '1', statusClientId: 'a', name: 'Kiosk', location: '  Shop  ' },
      { id: '3', statusClientId: 'b', name: 'Mac', location: ' ' },
      { id: '4', statusClientId: 'c', name: '', location: null },
    ] }), since);
    expect(result.storage.open.map(item => item.device)).toEqual(['Shop', 'Mac（b）', 'c', 'd']);
  });

  it('bounds arrays and strings and rejects unknown fields at every level', () => {
    const result = shapeDeviceHealth(rows({ alerts: Array.from({ length: 101 }, () => alert()),
      ext4Logs: Array.from({ length: 101 }, (_, i) => log(`ext4-${i}`)),
      powerLogs: Array.from({ length: 101 }, (_, i) => log(`power-${i}`, 'power_throttled_current', 'x'.repeat(600))),
      devices: [{ id: '1', statusClientId: 'a', name: '', location: 'x'.repeat(600) }] }), since);
    expect(result.storage.open).toHaveLength(100);
    expect(result.storage.last24h).toHaveLength(100);
    expect(result.ext4Errors).toHaveLength(100);
    expect(result.power).toHaveLength(100);
    expect(result.storage.open[0]?.device).toHaveLength(500);
    expect(result.power[0]?.raw).toHaveLength(500);
    expect(shapeDeviceHealth(rows({ alerts: Array.from({ length: 101 }, () => outage()) }), since).offline).toHaveLength(100);
    for (const invalid of [{ ...result, extra: true }, { ...result, storage: { ...result.storage, extra: true } },
      { ...result, ext4Errors: [{ ...result.ext4Errors[0], extra: true }] },
      { ...result, power: [...result.power, result.power[0]] }, { ...result, unavailable: false }]) {
      expect(deviceHealthSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('queries recent or open alerts, latest ext4 readings over seven days and daily power without device secrets', async () => {
    const alerts = vi.fn().mockResolvedValue([alert()]);
    const logs = vi.fn().mockResolvedValueOnce([log('b')]).mockResolvedValueOnce([log('c', 'power_throttled_current')]);
    const devices = vi.fn().mockResolvedValue([]);
    const prisma = { alert: { findMany: alerts }, clientLog: { findMany: logs }, clientDevice: { findMany: devices } } as unknown as PrismaClient;
    expect((await queryDeviceHealth(prisma, since)).attention).toBe('storage');
    expect(alerts.mock.calls[0]![0].where).toEqual({ AND: [
      { OR: [{ type: { startsWith: 'storage-health-' } }, { type: 'client-heartbeat-stale' }] },
      { OR: [{ timestamp: { gte: since } }, { acknowledged: false }] },
    ] });
    expect(logs.mock.calls[0]![0]).toMatchObject({ where: { createdAt: { gte: new Date('2026-10-20T00:00:00.000Z') },
      context: { path: ['signal'], equals: 'ext4_errors_recorded' } }, distinct: ['clientId'], orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }] });
    expect(logs.mock.calls[1]![0].where).toEqual({ createdAt: { gte: since }, AND: [
      { context: { path: ['category'], equals: 'storage_health' } }, { context: { path: ['signal'], string_starts_with: 'power_' } },
    ] });
    expect(devices).toHaveBeenCalledWith({ where: { statusClientId: { in: ['a', 'b', 'c'] } }, orderBy: { id: 'asc' },
      select: { id: true, statusClientId: true, location: true, name: true } });
  });
});
