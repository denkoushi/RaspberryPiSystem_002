export const toTrimmedString = (value: unknown): string => String(value ?? '').trim();
export const toUpperTrimmedCode = (value: string): string => value.trim().toUpperCase();
