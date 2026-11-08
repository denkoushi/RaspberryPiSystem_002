import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

type ScheduleTargets = { targetClientDeviceIds: string[]; targetClientKeys: string[] };
type TargetDatabase = Pick<PrismaClient, 'clientDevice'>;

export async function repairLegacyScheduleTargets(db: Pick<PrismaClient, 'clientDevice' | 'signageSchedule'>): Promise<number> {
  const rows = await db.signageSchedule.findMany({
    where: { targetClientDeviceIds: { isEmpty: true }, targetClientKeys: { isEmpty: false } },
    select: { id: true, targetClientKeys: true, enabled: true },
  });
  if (rows.length === 0) return 0;
  const devices = await db.clientDevice.findMany({
    where: { apiKey: { in: [...new Set(rows.flatMap((row) => row.targetClientKeys))] } },
    select: { id: true, apiKey: true },
  });
  const byKey = new Map(devices.map((device) => [device.apiKey, device.id]));
  let repairedCount = 0;
  for (const row of rows) {
    const keys = row.targetClientKeys.filter((key) => byKey.has(key));
    const ids = keys.map((key) => byKey.get(key)!);
    // Already disabled rows stay as the migration left them; skip the write.
    if (ids.length === 0 && !row.enabled) continue;
    const result = await db.signageSchedule.updateMany({
      where: { id: row.id, targetClientDeviceIds: { isEmpty: true } },
      data: ids.length > 0
        ? { targetClientDeviceIds: ids, targetClientKeys: keys }
        : { targetClientDeviceIds: [], enabled: false },
    });
    repairedCount += result.count;
  }
  return repairedCount;
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
