import { prisma } from '../../lib/prisma.js';

import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from './constants.js';

/**
 * 製番→機種名補完（FHINMEI_MH_SH CSV 同期テーブル）の参照。
 */
export class SeibanMachineNameSupplementRepository {
  async findByFseibans(fseibans: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const normalized = [...new Set(fseibans.map((f) => f.trim()).filter((f) => f.length > 0))];
    if (normalized.length === 0) {
      return map;
    }

    const rows = await prisma.productionScheduleSeibanMachineNameSupplement.findMany({
      where: {
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        fseiban: { in: normalized },
      },
      select: { fseiban: true, machineName: true },
    });

    for (const row of rows) {
      map.set(row.fseiban, row.machineName);
    }
    return map;
  }
}
