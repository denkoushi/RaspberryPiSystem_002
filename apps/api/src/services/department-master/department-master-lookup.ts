import { prisma } from '../../lib/prisma.js';

export type DepartmentMasterEntry = {
  code: string;
  name: string;
  kanaName: string | null;
  unitType: string;
  isSupplier: boolean;
  isCustomer: boolean;
};

const JST_OFFSET_MS = 9 * 3_600_000;

/** at を日本時間の日付にして、UTC 0時の Date で返す(@db.Date との比較用)。 */
export function toJstDate(at: Date): Date {
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

export async function findDepartmentMasterEntries(
  codes: readonly string[],
  at: Date
): Promise<Map<string, DepartmentMasterEntry>> {
  const result = new Map<string, DepartmentMasterEntry>();
  if (codes.length === 0) return result;
  const day = toJstDate(at);
  const rows = await prisma.departmentMasterEntry.findMany({
    where: { code: { in: [...codes] }, validFrom: { lte: day }, validTo: { gte: day } },
    select: { code: true, name: true, kanaName: true, unitType: true, isSupplier: true, isCustomer: true }
  });
  for (const row of rows) {
    result.set(row.code, row);
  }
  return result;
}
