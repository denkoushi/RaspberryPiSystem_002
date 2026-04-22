import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { getResourceNameMapByResourceCds } from '../production-schedule/resource-master.service.js';

const normalizeCd = (value: string): string => value.trim().toUpperCase();

export async function assertMachineCdRegistered(machineCdRaw: string): Promise<string> {
  const machineCd = normalizeCd(machineCdRaw);
  if (!machineCd) {
    throw new ApiError(400, '加工機コードが空です', undefined, 'PALLET_MACHINE_CD_EMPTY');
  }
  const row = await prisma.productionScheduleResourceMaster.findFirst({
    where: { resourceCd: machineCd },
    select: { resourceCd: true },
  });
  if (!row) {
    throw new ApiError(404, '加工機（資源マスタ）が登録されていません', undefined, 'PALLET_MACHINE_NOT_REGISTERED');
  }
  return machineCd;
}

export async function listRegisteredMachineCds(): Promise<string[]> {
  const rows = await prisma.productionScheduleResourceMaster.findMany({
    select: { resourceCd: true },
    distinct: ['resourceCd'],
    orderBy: { resourceCd: 'asc' },
  });
  return rows.map((r) => normalizeCd(r.resourceCd)).filter((c) => c.length > 0);
}

export async function resolvePrimaryMachineName(machineCd: string): Promise<string> {
  const map = await getResourceNameMapByResourceCds([machineCd]);
  const names = map[normalizeCd(machineCd)] ?? [];
  return names[0] ?? machineCd;
}
