const MAX_MACHINE_NAME_CHARS = 36;

export const toHalfWidthAscii = (value: string): string =>
  value.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');

export const normalizeComparisonText = (value: string | null | undefined): string =>
  toHalfWidthAscii((value ?? '').trim()).toUpperCase();

export const isMachinePartCode = (fhincd: string | null | undefined): boolean => {
  const normalized = normalizeComparisonText(fhincd);
  return normalized.startsWith('MH') || normalized.startsWith('SH');
};

export const normalizeMachineName = (
  value: string | null | undefined,
  options?: { maxChars?: number }
): string => {
  const normalized = toHalfWidthAscii(value?.trim() ?? '').toUpperCase();
  const maxChars = options?.maxChars ?? MAX_MACHINE_NAME_CHARS;
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
};
