import type { SelfInspectionMode } from './types';

export function mapTemplateFixedCountToFormString(
  mode: SelfInspectionMode,
  fixedCount: number | null | undefined,
  sampleSize: number | null | undefined
): string {
  if (mode !== 'fixed_count') return '';
  const n = fixedCount ?? sampleSize;
  return n != null ? String(n) : '';
}

export function parseSelfInspectionFixedCountInput(raw: string): number | null | typeof NaN {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isInteger(num) && num > 0 ? num : Number.NaN;
}

export function buildSelfInspectionTemplateApiBody(
  mode: SelfInspectionMode,
  fixedCountRaw: string
): { selfInspectionMode: SelfInspectionMode; selfInspectionFixedCount: number | null } | { error: string } {
  if (mode === 'fixed_count') {
    const parsed = parseSelfInspectionFixedCountInput(fixedCountRaw);
    if (parsed == null) {
      return { error: '指定数では検査件数を入力してください。' };
    }
    if (Number.isNaN(parsed)) {
      return { error: '検査件数は 1 以上の整数で入力してください。' };
    }
    return { selfInspectionMode: mode, selfInspectionFixedCount: parsed };
  }
  return { selfInspectionMode: mode, selfInspectionFixedCount: null };
}
