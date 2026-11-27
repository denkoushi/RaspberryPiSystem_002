import { toJstDate } from '../../lib/jst-date.js';
import { prisma } from '../../lib/prisma.js';

export type DepartmentMasterEntry = {
  code: string;
  name: string;
  kanaName: string | null;
  unitType: string;
  isSupplier: boolean;
  isCustomer: boolean;
};


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
