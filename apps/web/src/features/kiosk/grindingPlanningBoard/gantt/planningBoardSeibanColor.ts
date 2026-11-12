const SEIBAN_COLORS = [
  'bg-sky-400', 'bg-amber-400', 'bg-violet-400', 'bg-green-400', 'bg-pink-400',
  'bg-orange-400', 'bg-teal-300', 'bg-lime-300', 'bg-indigo-300', 'bg-cyan-200'
] as const;

export function planningBoardSeibanColor(seiban: string, seibanOrder: readonly string[]): string {
  if (seiban === '********') return 'bg-slate-400';
  const index = seibanOrder.indexOf(seiban);
  if (index >= 0) return SEIBAN_COLORS[index % SEIBAN_COLORS.length]!;
  let hash = 0;
  for (let i = 0; i < seiban.length; i += 1) hash = (Math.imul(hash, 31) + seiban.charCodeAt(i)) >>> 0;
  return SEIBAN_COLORS[hash % SEIBAN_COLORS.length]!;
}

const COLOR_HEX: Record<string, string> = {
  'bg-sky-400': '#38bdf8', 'bg-amber-400': '#fbbf24', 'bg-violet-400': '#a78bfa',
  'bg-green-400': '#4ade80', 'bg-pink-400': '#f472b6', 'bg-orange-400': '#fb923c',
  'bg-teal-300': '#5eead4', 'bg-lime-300': '#bef264', 'bg-indigo-300': '#a5b4fc',
  'bg-cyan-200': '#a5f3fc', 'bg-slate-400': '#94a3b8', 'bg-rose-400': '#fb7185'
};
export function operationSplitColor(color: string | undefined, index: number) {
  const base = COLOR_HEX[color ?? 'bg-sky-400'] ?? '#38bdf8';
  return index === 0 ? base : `color-mix(in srgb, ${base}, #fff ${Math.min(index * 22, 66)}%)`;
}
