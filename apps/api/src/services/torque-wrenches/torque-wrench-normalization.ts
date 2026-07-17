export function normalizeTorqueWrenchKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}

export function normalizeFastenerText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
}
