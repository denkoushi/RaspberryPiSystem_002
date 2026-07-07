import { prisma } from '../../lib/prisma.js';

export type AssemblyOperatorNfcResolveResult = {
  employeeId: string;
  displayName: string;
};

/** NFC UID を組立作業者（社員）に解決する */
export async function resolveAssemblyOperatorNfcUid(
  rawUid: string
): Promise<AssemblyOperatorNfcResolveResult | null> {
  const uid = rawUid.trim();
  if (!uid) {
    return null;
  }

  const employee = await prisma.employee.findFirst({
    where: { nfcTagUid: uid },
    select: { id: true, displayName: true, nfcTagUid: true }
  });

  if (!employee?.nfcTagUid) {
    return null;
  }

  return {
    employeeId: employee.id,
    displayName: employee.displayName
  };
}
