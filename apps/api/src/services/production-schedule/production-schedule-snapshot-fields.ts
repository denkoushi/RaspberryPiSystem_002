/** rowData から外寸らしき列を探す（環境差に耐える複数キー）。 */
const OUTSIDE_DIMENSION_ROW_DATA_KEYS = [
  'FGAISUN',
  'FSUNPO',
  'FGAISUNPO',
  'OutsideDimensions',
  'GAISUN',
  'FGAISUNKEI',
] as const;

/**
 * 外寸表示用: 前後空白除去・連続空白を1つに（カード内の固定レイアウト向け）。
 */
export function normalizeOutsideDimensionsDisplay(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function extractOutsideDimensionsDisplay(rowData: Record<string, unknown>): string | null {
  for (const key of OUTSIDE_DIMENSION_ROW_DATA_KEYS) {
    const v = rowData[key];
    if (typeof v === 'string') {
      const s = normalizeOutsideDimensionsDisplay(v);
      if (s.length > 0) return s;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return String(v);
    }
  }
  return null;
}
