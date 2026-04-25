import { palletVizCopy } from './copy';

/** 個数列（API の number | null）をカード表示用文字列へ */
export function formatPalletVizQuantityLabel(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return palletVizCopy.emDash;
  return String(q);
}

/** 着手日・製番などの表示用（空は em dash） */
export function formatPalletVizDisplayOrDash(value: string | null | undefined): string {
  const t = value?.trim();
  return t && t.length > 0 ? t : palletVizCopy.emDash;
}
