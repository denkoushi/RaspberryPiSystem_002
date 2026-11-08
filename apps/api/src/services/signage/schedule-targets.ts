import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

type ScheduleTargets = { targetClientDeviceIds: string[]; targetClientKeys: string[] };
type TargetDatabase = Pick<PrismaClient, 'clientDevice'>;

export async function resolveLegacyScheduleTargets<T extends ScheduleTargets>(db: TargetDatabase, rows: T[]): Promise<T[]> {
  const legacyRows = rows.filter((row) => row.targetClientDeviceIds.length === 0 && row.targetClientKeys.length > 0);
  if (legacyRows.length === 0) return rows;
  const devices = await db.clientDevice.findMany({
    where: { apiKey: { in: [...new Set(legacyRows.flatMap((row) => row.targetClientKeys))] } },
    select: { id: true, apiKey: true },
  });
  const byKey = new Map(devices.map((device) => [device.apiKey, device.id]));
  return rows.map((row) => {
    if (row.targetClientDeviceIds.length > 0 || row.targetClientKeys.length === 0) return row;
    const ids = row.targetClientKeys.flatMap((key) => byKey.has(key) ? [byKey.get(key)!] : []);
    // The matcher cannot match an empty string, even as a device ID.
    return { ...row, targetClientDeviceIds: ids.length > 0 ? ids : [''] };
  });
}

export async function resolveScheduleTargets(
  db: TargetDatabase,
  input: Partial<ScheduleTargets>,
  stored?: ScheduleTargets | null,
) {
  const ids = input.targetClientDeviceIds;
  const requested = [...new Set(ids ?? input.targetClientKeys ?? [])];
  const devices = requested.length === 0 ? [] : await db.clientDevice.findMany({
    where: ids !== undefined ? { id: { in: requested } } : { apiKey: { in: requested } },
    select: { id: true, apiKey: true },
  });
  const byTarget = new Map(devices.map((device) => [ids !== undefined ? device.id : device.apiKey, device]));
  const previous = new Set((ids !== undefined ? stored?.targetClientDeviceIds : stored?.targetClientKeys) ?? []);
  const known = requested.filter((target) => byTarget.has(target));
  if (requested.some((target) => !byTarget.has(target) && !previous.has(target)) || (requested.length > 0 && known.length === 0)) {
    throw new ApiError(400, '登録済み端末のみ選択できます', undefined, 'INVALID_SIGNAGE_TARGET');
  }
  return {
    targetClientDeviceIds: known.map((target) => byTarget.get(target)!.id),
    targetClientKeys: known.map((target) => byTarget.get(target)!.apiKey),
  };
}
