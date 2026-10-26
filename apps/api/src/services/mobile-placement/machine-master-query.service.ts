import { prisma } from '../../lib/prisma.js';
import { listProductionScheduleResources } from '../production-schedule/production-schedule-query/resources.js';

const SENDAI_RESOURCE_GROUP_PREFIX = 'S-';

export type MachineMasterEntry = {
  resourceCd: string;
  resourceName: string;
};

export async function listMachineMastersForShelfLayout(): Promise<{ machines: MachineMasterEntry[] }> {
  const rows = await prisma.productionScheduleResourceMaster.findMany({
    select: { resourceCd: true, resourceName: true },
    orderBy: [{ resourceName: 'asc' }, { resourceCd: 'asc' }]
  });
  return {
    machines: rows.map((r) => ({
      resourceCd: r.resourceCd,
      resourceName: r.resourceName
    }))
  };
}

/** 三島の生産スケジュールに登場する加工機。切削用の除外フラグは適用しない。 */
/** 資源マスタのグループCDが S- で始まる資源は仙台工場のため除外する。 */
export async function listMachinesForShelfRegistration(): Promise<{ machines: string[] }> {
  const [{ resources, resourceNameMap }, sendaiRows] = await Promise.all([
    listProductionScheduleResources({}),
    prisma.productionScheduleResourceMaster.findMany({
      where: { resourceGroupCd: { startsWith: SENDAI_RESOURCE_GROUP_PREFIX } },
      select: { resourceCd: true }
    })
  ]);
  const sendaiCodes = new Set(sendaiRows.map((r) => r.resourceCd.trim().toUpperCase()));
  const names = resources.filter((code) => !sendaiCodes.has(code.trim().toUpperCase())).flatMap((code) => {
    const mapped = (resourceNameMap[code.trim().toUpperCase()] ?? []).map((name) => name.trim()).filter(Boolean);
    return mapped.length ? mapped : [code];
  });
  return { machines: [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ja')) };
}
