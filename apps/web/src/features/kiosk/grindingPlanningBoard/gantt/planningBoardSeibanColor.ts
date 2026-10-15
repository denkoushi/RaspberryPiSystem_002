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
