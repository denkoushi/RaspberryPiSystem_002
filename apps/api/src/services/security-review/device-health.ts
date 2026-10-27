import type { Alert, ClientDevice, ClientLog, PrismaClient } from '@prisma/client';
import { deviceHealthSchema, type DeviceHealth } from './report-schema.js';

type HealthAlert = Pick<Alert, 'type' | 'source' | 'details' | 'severity' | 'timestamp' | 'acknowledged' | 'acknowledgedAt'>;
type HealthLog = Pick<ClientLog, 'clientId' | 'context' | 'createdAt'>;
type HealthDevice = Pick<ClientDevice, 'id' | 'statusClientId' | 'location' | 'name'>;
type HealthRows = { alerts: HealthAlert[]; ext4Logs: HealthLog[]; powerLogs: HealthLog[]; devices: HealthDevice[] };
const DAY_MS = 24 * 60 * 60_000;
const field = (value: unknown, key: string): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' ? item : '';
};
const clientIdOf = (alert: HealthAlert) => field(alert.source, 'clientId') || field(alert.details, 'clientId');
const filesystemSignal = (signal: string) => /ext4|filesystem|kernel_storage|sd_/.test(signal);

export function shapeDeviceHealth(rows: HealthRows, since: Date): DeviceHealth {
  const devices = new Map<string, HealthDevice>();
  for (const device of [...rows.devices].sort((a, b) => a.id.localeCompare(b.id))) {
    if (device.statusClientId && !devices.has(device.statusClientId)) devices.set(device.statusClientId, device);
  }
  const label = (clientId: string) => {
    const device = devices.get(clientId);
    return device?.location?.trim() || (device?.name ? `${device.name}（${clientId}）` : clientId);
  };
  const storageRows = rows.alerts.filter(row => row.type?.startsWith('storage-health-') && clientIdOf(row))
    .map(row => ({ row, item: { clientId: clientIdOf(row), device: label(clientIdOf(row)),
      signal: field(row.details, 'signal') || row.type!.slice('storage-health-'.length),
      severity: row.severity, timestamp: row.timestamp.toISOString() } }))
    .sort((a, b) => Number(filesystemSignal(b.item.signal)) - Number(filesystemSignal(a.item.signal)) ||
      b.row.timestamp.getTime() - a.row.timestamp.getTime() || a.item.clientId.localeCompare(b.item.clientId) ||
      a.item.signal.localeCompare(b.item.signal));
  const storage = {
    open: storageRows.filter(({ row }) => !row.acknowledged).slice(0, 100).map(({ item }) => item),
    last24h: storageRows.filter(({ row }) => row.timestamp >= since).slice(0, 100).map(({ item }) => item),
  };
  const latestExt4 = new Map<string, HealthLog>();
  for (const row of rows.ext4Logs) {
    if (!latestExt4.has(row.clientId) || row.createdAt > latestExt4.get(row.clientId)!.createdAt) latestExt4.set(row.clientId, row);
  }
  const ext4Errors = [...latestExt4.values()].flatMap(row => {
    const raw = field(row.context, 'raw').trim();
    const count = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(count) || count <= 0) return [];
    return [{ clientId: row.clientId, device: label(row.clientId), count,
      observedAt: field(row.context, 'observedAt') || row.createdAt.toISOString() }];
  }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.clientId.localeCompare(b.clientId)).slice(0, 100);
  const powerGroups = new Map<string, DeviceHealth['power'][number]>();
  for (const row of rows.powerLogs) {
    const signal = field(row.context, 'signal');
    if (row.createdAt < since || field(row.context, 'category') !== 'storage_health' || !signal.startsWith('power_')) continue;
    const key = JSON.stringify([row.clientId, signal]);
    const time = row.createdAt.toISOString();
    const raw = field(row.context, 'raw').slice(0, 500);
    const group = powerGroups.get(key);
    if (!group) powerGroups.set(key, { clientId: row.clientId, device: label(row.clientId), signal, count: 1, first: time, last: time, raw });
    else {
      group.count++;
      if (time < group.first) group.first = time;
      if (time > group.last) { group.last = time; group.raw = raw; }
    }
  }
  const power = [...powerGroups.values()].sort((a, b) => b.last.localeCompare(a.last) ||
    a.clientId.localeCompare(b.clientId) || a.signal.localeCompare(b.signal)).slice(0, 100);
  const offline = rows.alerts.filter(row => row.type === 'client-heartbeat-stale' &&
    (row.timestamp >= since || !row.acknowledged) && clientIdOf(row) && field(row.details, 'lastSeen'))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || clientIdOf(a).localeCompare(clientIdOf(b)))
    .slice(0, 100).map(row => ({ clientId: clientIdOf(row), device: label(clientIdOf(row)),
      lastSeen: field(row.details, 'lastSeen'), detectedAt: row.timestamp.toISOString(), endedAt: row.acknowledgedAt?.toISOString() ?? null }));
  return deviceHealthSchema.parse({
    attention: storage.open.length || storage.last24h.length || ext4Errors.length ? 'storage' : power.length ? 'power' : offline.length ? 'offline' : 'none',
    storage, ext4Errors, power, offline,
  });
}

export async function queryDeviceHealth(prisma: PrismaClient, since: Date): Promise<DeviceHealth> {
  const [alerts, ext4Logs, powerLogs] = await Promise.all([
    prisma.alert.findMany({
      where: { AND: [
        { OR: [{ type: { startsWith: 'storage-health-' } }, { type: 'client-heartbeat-stale' }] },
        { OR: [{ timestamp: { gte: since } }, { acknowledged: false }] },
      ] },
      select: { type: true, source: true, details: true, severity: true, timestamp: true, acknowledged: true, acknowledgedAt: true },
      orderBy: [{ timestamp: 'desc' }, { id: 'asc' }],
    }),
    prisma.clientLog.findMany({
      where: { createdAt: { gte: new Date(since.getTime() - 6 * DAY_MS) }, context: { path: ['signal'], equals: 'ext4_errors_recorded' } },
      distinct: ['clientId'], orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
      select: { clientId: true, context: true, createdAt: true },
    }),
    prisma.clientLog.findMany({
      where: { createdAt: { gte: since }, AND: [
        { context: { path: ['category'], equals: 'storage_health' } },
        { context: { path: ['signal'], string_starts_with: 'power_' } },
      ] },
      select: { clientId: true, context: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
  ]);
  const clientIds = [...new Set([...alerts.map(clientIdOf), ...ext4Logs.map(row => row.clientId), ...powerLogs.map(row => row.clientId)])].filter(Boolean);
  const devices = await prisma.clientDevice.findMany({
    where: { statusClientId: { in: clientIds } }, orderBy: { id: 'asc' },
    select: { id: true, statusClientId: true, location: true, name: true },
  });
  return shapeDeviceHealth({ alerts, ext4Logs, powerLogs, devices }, since);
}
