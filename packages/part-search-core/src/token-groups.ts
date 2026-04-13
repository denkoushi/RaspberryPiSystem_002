import { expandSearchTerms } from './aliases.js';
import { normalizePartSearchQuery } from './normalize.js';

/**
 * 空白区切りの各トークンを AND 条件とし、トークン内は別名展開後に OR とする。
 * 返却の各要素は「1 トークン分の OR 候補語」の配列。
 */
export function buildTokenGroupsForSearch(rawQuery: string): {
  tokenGroups: string[][];
  aliasMatchedBy: string | null;
} {
  const normalized = normalizePartSearchQuery(rawQuery);
  if (normalized.length === 0) {
    return { tokenGroups: [], aliasMatchedBy: null };
  }
  const parts = normalized.split(/\s+/).filter((p) => p.length > 0);
  const tokenGroups: string[][] = [];
  const aliasLabels: string[] = [];
  for (const p of parts) {
    const { terms, aliasMatchedBy } = expandSearchTerms(p);
    if (terms.length === 0) continue;
    tokenGroups.push(terms);
    if (aliasMatchedBy) aliasLabels.push(aliasMatchedBy);
  }
  const aliasMatchedBy = aliasLabels.length > 0 ? [...new Set(aliasLabels)].join(', ') : null;
  return { tokenGroups, aliasMatchedBy };
}
