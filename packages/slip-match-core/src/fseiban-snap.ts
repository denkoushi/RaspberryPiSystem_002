/** Symmetric OCR substitutions, including every pair within each group. */
export const FSEIBAN_CONFUSABLE_GROUPS = ['0ODQ', '1IL', '2Z', '5S', '8B', '6G', 'UV'] as const;
export const FSEIBAN_CONFUSABLE_COST = 0.3;
/**
 * Automatic correction: at most two confusable substitutions, with a clear margin.
 * The slip's expected 製番 is deliberately NOT used as a hint: biasing toward it could turn a
 * genuinely different 製番 (e.g. BE1N9321 vs BE1N9327) into a false match.
 */
export const FSEIBAN_CORRECTED_MAX_DISTANCE = 0.6;
export const FSEIBAN_MIN_MARGIN = 0.5;
/** More distant results are neither offered nor automatically selected. */
export const FSEIBAN_CANDIDATE_MAX_DISTANCE = 2.0;
export const FSEIBAN_MAX_LENGTH_DIFFERENCE = 2;

export function normalizeFseibanToken(raw: string): string {
  return raw.normalize('NFKC').toUpperCase().replace(/[\s_-]/g, '');
}

export function fseibanOcrDistance(a: string, b: string): number {
  // Integer tenths avoid floating-point errors at threshold boundaries.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i * 10);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i * 10;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0
        : FSEIBAN_CONFUSABLE_GROUPS.some((group) => group.includes(a[i - 1]) && group.includes(b[j - 1]))
          ? FSEIBAN_CONFUSABLE_COST * 10 : 10;
      current[j] = Math.min(previous[j] + 10, current[j - 1] + 10, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] / 10;
}

export type FseibanSnapResult = {
  match: 'exact' | 'corrected' | 'ambiguous' | 'none';
  fseiban: string | null;
  candidates: string[];
};

export function snapFseiban(ocrTokens: string[], known: readonly string[]): FseibanSnapResult {
  const tokens = [...new Set(ocrTokens.map(normalizeFseibanToken).filter(Boolean))];
  const values = [...new Set(known.filter(Boolean))];
  const knownSet = new Set(values);
  for (const token of tokens) {
    if (knownSet.has(token)) return { match: 'exact', fseiban: token, candidates: [token] };
  }
  const distance = (value: string) => tokens.reduce((best, token) =>
    Math.abs(token.length - value.length) <= FSEIBAN_MAX_LENGTH_DIFFERENCE
      ? Math.min(best, fseibanOcrDistance(token, value)) : best, Infinity);
  const ranked = values.map((value) => ({ value, distance: distance(value) }))
    .filter((entry) => entry.distance <= FSEIBAN_CANDIDATE_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance || a.value.localeCompare(b.value));
  const best = ranked[0];
  if (!best) return { match: 'none', fseiban: null, candidates: [] };
  const candidates = ranked.slice(0, 3).map((entry) => entry.value);
  if (best.distance <= FSEIBAN_CORRECTED_MAX_DISTANCE &&
      (ranked[1]?.distance ?? Infinity) >= best.distance + FSEIBAN_MIN_MARGIN) {
    return { match: 'corrected', fseiban: best.value, candidates };
  }
  return { match: 'ambiguous', fseiban: null, candidates };
}
