import { resolveActiveAssemblyOperatorNfcUid } from './assembly-operator-nfc-resolve.service.js';

import type { ProcedureMaterial } from '@prisma/client';

import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

/** 開発者が試験に使う社員番号。素材→社員番号の確認では社員の状態を問わず通す。 */
export const DEVELOPER_EMPLOYEE_NUMBER = '9999';

export function normalizeEmployeeNumber(value: string | null | undefined): string | null {
  const number = value?.trim() ?? '';
  return /^[0-9]+$/.test(number) ? number.replace(/^0+(?=\d)/, '') : null;
}

export function materialAppText(material: Pick<ProcedureMaterial, 'origin' | 'appRef'>, key: string): string | null {
  const ref = material.origin === 'APP' ? material.appRef : null;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  const value = ref[key];
  return typeof value === 'string' ? value : key === 'nameId' && typeof value === 'number' ? String(value) : null;
}

export function isDeveloperEmployeeNumber(value: string | null | undefined): boolean {
  return normalizeEmployeeNumber(value) === DEVELOPER_EMPLOYEE_NUMBER;
}

/** 素材→社員番号用の社員タグ解決。在籍の社員に加え、開発者番号は状態を問わず通す。 */
export function resolveProcedureMaterialEmployeeTag(db: Pick<AssemblyTransactionClient, 'employee'>, rawUid: string) {
  return resolveActiveAssemblyOperatorNfcUid(db, rawUid, { allowInactive: (employee) => isDeveloperEmployeeNumber(employee.employeeCode) });
}
