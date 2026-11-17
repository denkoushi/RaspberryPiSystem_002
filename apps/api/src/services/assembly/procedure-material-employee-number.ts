import type { ProcedureMaterial } from '@prisma/client';

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
