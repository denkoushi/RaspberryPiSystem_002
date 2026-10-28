import { normalizePartSearchQuery } from './normalize.js';

/**
 * 管理された同義語グループ。広げすぎると誤ヒットが増えるため、少数から開始する。
 */
export const PART_SEARCH_ALIAS_GROUPS: readonly (readonly string[])[] = [['アシ', '脚', '足'] as const];

/**
 * 単一トークンに対し、同義語グループが含まれる場合はグループ内の語を OR 検索に展開する。
 */
export function expandSearchTerms(normalizedToken: string): {
  terms: string[];
  aliasMatchedBy: string | null;
} {
  if (normalizedToken.length === 0) {
    return { terms: [], aliasMatchedBy: null };
  }
  let terms = new Set<string>([normalizedToken]);
  const matchedGroups: string[] = [];
  for (const group of PART_SEARCH_ALIAS_GROUPS) {
    // Group words go through the same fold as the token (e.g. dakuten-less).
    const matchedTokens = group.filter((g) => normalizedToken.includes(normalizePartSearchQuery(g)));
    if (matchedTokens.length > 0) {
      matchedGroups.push([...group].join('/'));
      const nextTerms = new Set(terms);
      for (const term of terms) {
        for (const matchedToken of matchedTokens) {
          const folded = normalizePartSearchQuery(matchedToken);
          if (!term.includes(folded)) continue;
          for (const replacement of group) {
            nextTerms.add(term.split(folded).join(replacement));
          }
        }
      }
      terms = nextTerms;
    }
  }
  const normalizedTerms = [...terms].map((t) => normalizePartSearchQuery(t));
  return {
    terms: normalizedTerms,
    aliasMatchedBy: matchedGroups.length > 0 ? matchedGroups.join(', ') : null
  };
}
