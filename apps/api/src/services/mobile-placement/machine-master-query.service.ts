import { prisma } from '../../lib/prisma.js';
import { toUpperTrimmedCode as normalizeResourceCd } from '../../lib/string-normalize.js';
import { listProductionScheduleResources } from '../production-schedule/production-schedule-query/resources.js';
import { getSendaiResourceCds } from '../production-schedule/resource-master.service.js';

export type MachineMasterEntry = {
  resourceCd: string;
  resourceName: string;
};

export async function listMachineMastersForShelfLayout(): Promise<{ machines: MachineMasterEntry[] }> {
  const [rows, sendaiResourceCds] = await Promise.all([
    prisma.productionScheduleResourceMaster.findMany({
      select: { resourceCd: true, resourceName: true },
      orderBy: [{ resourceName: 'asc' }, { resourceCd: 'asc' }]
    }),
    getSendaiResourceCds()
  ]);
  return {
    machines: rows.filter((r) => !sendaiResourceCds.has(normalizeResourceCd(r.resourceCd))).map((r) => ({
      resourceCd: r.resourceCd,
      resourceName: r.resourceName
    }))
  };
}

/** 三島の生産スケジュールに登場する加工機。切削用の除外フラグは適用しない。 */
export async function listMachinesForShelfRegistration(): Promise<{ machines: string[] }> {
  const { resources, resourceNameMap } = await listProductionScheduleResources({});
  const names = resources.flatMap((code) => {
    const mapped = (resourceNameMap[code.trim().toUpperCase()] ?? []).map((name) => name.trim()).filter(Boolean);
    return mapped.length ? mapped : [code];
  });
  return { machines: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ja')) };
}
