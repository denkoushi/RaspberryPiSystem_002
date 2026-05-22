/**
 * 順位ボード行左縁の識別色を安定割当する（Tailwind クラスはリテラル列挙）。
 * - **フィルタが 1 件以上**: リスト順とアクセントを対応付けし、リスト外の製番行は製番文字列ハッシュで配色。
 * - **フィルタが空（全件表示）**: 左縁なし（色が多すぎて識別しづらいため）。
 */

const BORDER_LEFT_WIDTH = 'border-l-4';

/**
 * ダーク背景上で区別しやすい彩度のある左縁（動的連結禁止のため列挙）。
 * 先頭 8 色は登録製番 OR フィルタ（同時 ~5 件）向けの既存順序を維持する。
 */
const SEIBAN_ROW_ACCENT_PALETTE = [
  `${BORDER_LEFT_WIDTH} border-l-amber-400`,
  `${BORDER_LEFT_WIDTH} border-l-cyan-400`,
  `${BORDER_LEFT_WIDTH} border-l-rose-400`,
  `${BORDER_LEFT_WIDTH} border-l-violet-400`,
  `${BORDER_LEFT_WIDTH} border-l-emerald-400`,
  `${BORDER_LEFT_WIDTH} border-l-orange-400`,
  `${BORDER_LEFT_WIDTH} border-l-sky-400`,
  `${BORDER_LEFT_WIDTH} border-l-fuchsia-400`,
  `${BORDER_LEFT_WIDTH} border-l-red-400`,
  `${BORDER_LEFT_WIDTH} border-l-yellow-400`,
  `${BORDER_LEFT_WIDTH} border-l-lime-400`,
  `${BORDER_LEFT_WIDTH} border-l-green-400`,
  `${BORDER_LEFT_WIDTH} border-l-teal-400`,
  `${BORDER_LEFT_WIDTH} border-l-blue-400`,
  `${BORDER_LEFT_WIDTH} border-l-indigo-400`,
  `${BORDER_LEFT_WIDTH} border-l-purple-400`,
  `${BORDER_LEFT_WIDTH} border-l-pink-400`,
  `${BORDER_LEFT_WIDTH} border-l-red-300`,
  `${BORDER_LEFT_WIDTH} border-l-yellow-300`,
  `${BORDER_LEFT_WIDTH} border-l-lime-300`,
  `${BORDER_LEFT_WIDTH} border-l-green-300`,
  `${BORDER_LEFT_WIDTH} border-l-blue-300`,
  `${BORDER_LEFT_WIDTH} border-l-indigo-300`,
  `${BORDER_LEFT_WIDTH} border-l-purple-300`
] as const;

function normalizeFilters(activeFilters: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of activeFilters) {
    const t = f.trim();
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** フィルタ集合外の製番行向け：文字列から安定したインデックス */
export function seibanAccentPaletteIndexForString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % SEIBAN_ROW_ACCENT_PALETTE.length;
}

/**
 * @returns 行コンテナに付与する Tailwind クラス。製番が空、または OR フィルタ未選択時は undefined。
 */
export function resolveSeibanAccentRowClass(
  fseiban: string,
  activeFilters: readonly string[]
): string | undefined {
  const fs = fseiban.trim();
  if (!fs.length) {
    return undefined;
  }
  const filters = normalizeFilters(activeFilters);
  if (filters.length === 0) {
    return undefined;
  }
  const idx = filters.indexOf(fs);
  const paletteIdx =
    idx >= 0 ? idx % SEIBAN_ROW_ACCENT_PALETTE.length : seibanAccentPaletteIndexForString(fs);
  return SEIBAN_ROW_ACCENT_PALETTE[paletteIdx];
}
