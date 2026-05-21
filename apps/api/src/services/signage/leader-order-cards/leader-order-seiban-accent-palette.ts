/**
 * キオスク `seibanAccentPalette.ts` と同一の安定ハッシュ（全件表示時の製番左縁色）。
 * SVG 用に Tailwind 400 系の hex を列挙（動的連結なし）。
 */
export const LEADER_ORDER_SVG_SEIBAN_ACCENT_HEX = [
  '#fbbf24', // amber-400
  '#22d3ee', // cyan-400
  '#fb7185', // rose-400
  '#a78bfa', // violet-400
  '#34d399', // emerald-400
  '#fb923c', // orange-400
  '#38bdf8', // sky-400
  '#e879f9', // fuchsia-400
  '#f87171', // red-400
  '#facc15', // yellow-400
  '#a3e635', // lime-400
  '#4ade80', // green-400
  '#2dd4bf', // teal-400
  '#60a5fa', // blue-400
  '#818cf8', // indigo-400
  '#c084fc', // purple-400
  '#f472b6', // pink-400
  '#fca5a5', // red-300
  '#fde047', // yellow-300
  '#bef264', // lime-300
  '#86efac', // green-300
  '#93c5fd', // blue-300
  '#a5b4fc', // indigo-300
  '#d8b4fe', // purple-300
] as const;

export function seibanAccentPaletteIndexForString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % LEADER_ORDER_SVG_SEIBAN_ACCENT_HEX.length;
}

/** 製番文字列から左縁アクセント色（hex）を返す。空製番は undefined。 */
export function resolveSeibanAccentHexForSignage(fseiban: string): string | undefined {
  const fs = fseiban.trim();
  if (!fs.length) return undefined;
  return LEADER_ORDER_SVG_SEIBAN_ACCENT_HEX[seibanAccentPaletteIndexForString(fs)];
}
