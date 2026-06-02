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

export function parseToleranceRawFields(
  fields: ToleranceRawFields
): ParsedToleranceBounds | { error: string } {
  const nominal = parseRequiredFinite(fields.nominalRaw, '基準値');
  if (typeof nominal === 'object' && 'error' in nominal) {
    return nominal;
  }
  const upperTol = parseRequiredNonNegative(fields.upperToleranceRaw, '上側公差');
  if (typeof upperTol === 'object' && 'error' in upperTol) {
    return upperTol;
  }
  const lowerTol = parseRequiredNonNegative(fields.lowerToleranceRaw, '下側公差');
  if (typeof lowerTol === 'object' && 'error' in lowerTol) {
    return lowerTol;
  }
  const lowerLimit = round6(nominal - lowerTol);
  const upperLimit = round6(nominal + upperTol);
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

function parseRequiredNonNegative(
  raw: string,
  label: string
): number | { error: string } {
  const parsed = parseRequiredFinite(raw, label);
  if (typeof parsed === 'object' && 'error' in parsed) {
    return parsed;
  }
  if (parsed < 0) {
    return { error: `${label}は0以上で入力してください` };
  }
  return parsed;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function absoluteBoundsToToleranceRaw(
  nominal: number,
  lowerLimit: number,
  upperLimit: number
): ToleranceRawFields {
  const lo = Math.min(lowerLimit, upperLimit);
  const hi = Math.max(lowerLimit, upperLimit);
  const lowerTol = Math.max(0, round6(nominal - lo));
  const upperTol = Math.max(0, round6(hi - nominal));
  return {
    nominalRaw: formatRaw(nominal),
    lowerToleranceRaw: formatRaw(lowerTol),
    upperToleranceRaw: formatRaw(upperTol)
  };
}

function formatRaw(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export function formatToleranceRawNumber(n: number): string {
  return formatRaw(n);
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
