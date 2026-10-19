import { normalizeFastenerText } from '@raspi-system/shared-types';

export function normalizeTorqueWrenchKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}

export { normalizeFastenerText };
