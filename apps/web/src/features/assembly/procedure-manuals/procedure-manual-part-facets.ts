export function extractProcedureManualPartFacets(partNames: string[]) {
  const parts = partNames.map(partName => {
    const normalized = partName.trim().replace(/[Ａ-Ｚ]/g, letter => String.fromCharCode(letter.charCodeAt(0) - 0xfee0));
    // ABC部品 のように英数字が続く品番風の名前は軸として扱わない。
    const match = normalized.match(/^([A-Z])(?:軸(.+)|([^A-Za-z0-9軸].*))$/);
    return match
      ? { axis: match[1], rest: (match[2] ?? match[3]).trim() }
      : { axis: '', rest: normalized };
  });
  const rests = [...new Set(parts.map(part => part.rest).filter(Boolean))].sort((a, b) => b.length - a.length);
  const facets = parts.map(({ axis, rest }) => ({
    axis,
    name: rests.find(prefix => prefix !== rest && rest.startsWith(prefix)) ?? rest
  }));
  const counts = new Map<string, number>();
  for (const { name } of facets) {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    facets,
    axes: [...new Set(facets.map(facet => facet.axis).filter(Boolean))].sort(),
    names: [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b, 'ja'))
  };
}
