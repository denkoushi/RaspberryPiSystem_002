export type ToleranceRawFields = {
  nominalRaw: string;
  lowerToleranceRaw: string;
  upperToleranceRaw: string;
};

export type ParsedToleranceBounds = {
  nominal: number;
  lowerLimit: number;
  upperLimit: number;
};

/** 符号付き offset → 絶対上下限（保存・判定の正本） */
export function parseToleranceRawFields(
  fields: ToleranceRawFields
): ParsedToleranceBounds | { error: string } {
  const nominal = parseRequiredFinite(fields.nominalRaw, '基準値');
  if (typeof nominal === 'object' && 'error' in nominal) {
    return nominal;
  }
  const lowerOffset = parseRequiredFinite(fields.lowerToleranceRaw, '下限公差');
  if (typeof lowerOffset === 'object' && 'error' in lowerOffset) {
    return lowerOffset;
  }
  const upperOffset = parseRequiredFinite(fields.upperToleranceRaw, '上限公差');
  if (typeof upperOffset === 'object' && 'error' in upperOffset) {
    return upperOffset;
  }
  const lowerLimit = round6(nominal + lowerOffset);
  const upperLimit = round6(nominal + upperOffset);
  if (lowerLimit > upperLimit) {
    return { error: '下限が上限より大きいです' };
  }
  return { nominal, lowerLimit, upperLimit };
}

function parseRequiredFinite(raw: string, label: string): number | { error: string } {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) {
    return { error: `${label}を入力してください` };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { error: `${label}の形式が不正です` };
  }
  return n;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** 絶対上下限 → 符号付き offset UI raw */
export function absoluteBoundsToToleranceRaw(
  nominal: number,
  lowerLimit: number,
  upperLimit: number
): ToleranceRawFields {
  const lo = Math.min(lowerLimit, upperLimit);
  const hi = Math.max(lowerLimit, upperLimit);
  return {
    nominalRaw: formatRaw(nominal),
    lowerToleranceRaw: formatRaw(round6(lo - nominal)),
    upperToleranceRaw: formatRaw(round6(hi - nominal))
  };
}

function formatRaw(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export function formatToleranceRawNumber(n: number): string {
  return formatRaw(round6(n));
}

/** 公差 raw 文字列から保存用 decimalPlaces を推定（0–6） */
export function inferDecimalPlacesFromToleranceRaw(fields: ToleranceRawFields): number {
  const parts = [
    fields.nominalRaw,
    fields.lowerToleranceRaw,
    fields.upperToleranceRaw
  ];
  let maxPlaces = 0;
  for (const raw of parts) {
    maxPlaces = Math.max(maxPlaces, decimalPlacesInRaw(raw));
  }
  return Math.min(6, Math.max(0, maxPlaces));
}

function decimalPlacesInRaw(raw: string): number {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) return 0;
  const dot = trimmed.indexOf('.');
  if (dot < 0) return 0;
  return trimmed.length - dot - 1;
}

/** DB の絶対上下限 → UI raw（nominal null のときは 0 に潰さない） */
export function dbAbsoluteBoundsToToleranceRawFields(input: {
  nominalValue: number | null;
  lowerLimit: number | null;
  upperLimit: number | null;
}): ToleranceRawFields & { legacyAbsoluteBounds?: { lowerLimit: number; upperLimit: number } } {
  const nominal = input.nominalValue;
  const lower = input.lowerLimit;
  const upper = input.upperLimit;

  if (nominal == null && lower != null && upper != null) {
    return {
      nominalRaw: '',
      lowerToleranceRaw: '',
      upperToleranceRaw: '',
      legacyAbsoluteBounds: { lowerLimit: lower, upperLimit: upper }
    };
  }

  if (nominal != null && lower != null && upper != null) {
    return absoluteBoundsToToleranceRaw(nominal, lower, upper);
  }

  return {
    nominalRaw: nominal != null ? formatRaw(nominal) : '',
    lowerToleranceRaw: '',
    upperToleranceRaw: ''
  };
}
