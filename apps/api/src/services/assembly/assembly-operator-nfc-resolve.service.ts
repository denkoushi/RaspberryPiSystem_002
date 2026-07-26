import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import type { EmployeeStatus } from '@prisma/client';

import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

export type AssemblyOperatorNfcResolveResult = {
  employeeId: string;
  employeeCode: string;
  displayName: string;
  nfcTagUid: string;
};

type AssemblyOperatorNfcDb = Pick<AssemblyTransactionClient, 'employee'>;

async function findAssemblyOperatorNfcUid(
  db: AssemblyOperatorNfcDb,
  rawUid: string
): Promise<(AssemblyOperatorNfcResolveResult & { status: EmployeeStatus }) | null> {
  const uid = rawUid.trim();
  if (!uid) {
    return null;
  }

  const employee = await db.employee.findFirst({
    where: { nfcTagUid: uid },
    select: {
      id: true,
      employeeCode: true,
      displayName: true,
      nfcTagUid: true,
      status: true
    }
  });

  if (!employee?.nfcTagUid) {
    return null;
  }

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    nfcTagUid: employee.nfcTagUid,
    status: employee.status
  };
}

/** NFC UID を有効な組立作業者（社員）に解決する。 */
export async function resolveActiveAssemblyOperatorNfcUid(
  db: AssemblyOperatorNfcDb,
  rawUid: string
): Promise<AssemblyOperatorNfcResolveResult> {
  const employee = await findAssemblyOperatorNfcUid(db, rawUid);
  if (!employee) {
    throw new ApiError(404, '社員タグが見つかりません');
  }
  if (employee.status !== 'ACTIVE') {
    throw new ApiError(403, '有効な社員のみ組立作業を開始・再開できます');
  }
  return {
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    nfcTagUid: employee.nfcTagUid
  };
}

/** 既存のNFC解決API向け互換関数。非ACTIVE社員は明示的に拒否する。 */
export async function resolveAssemblyOperatorNfcUid(
  rawUid: string
): Promise<AssemblyOperatorNfcResolveResult | null> {
  if (!rawUid.trim()) return null;
  const employee = await findAssemblyOperatorNfcUid(prisma, rawUid);
  if (!employee) return null;
  if (employee.status !== 'ACTIVE') {
    throw new ApiError(403, '有効な社員のみ組立作業を開始・再開できます');
  }
  return {
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    nfcTagUid: employee.nfcTagUid
  };
}
