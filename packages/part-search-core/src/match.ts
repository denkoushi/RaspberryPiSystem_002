import { normalizePartSearchQuery } from './normalize.js';
import { buildTokenGroupsForSearch } from './token-groups.js';

function ilikeIncludes(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * 現在棚行の FHINMEI / FHINCD に対し、API と同じ AND + 別名 OR の条件で一致するか。
 * 剪定用にクライアント側で使用する（表示中のヒット集合に対する近似）。
 */
export function matchesPartSearchFields(
  fields: { fhinmei: string | null; fhincd: string | null },
  rawQuery: string
): boolean {
  const { tokenGroups } = buildTokenGroupsForSearch(rawQuery);
  if (tokenGroups.length === 0) return false;

  const mei = normalizePartSearchQuery(fields.fhinmei ?? '');
  const cd = normalizePartSearchQuery(fields.fhincd ?? '');

  for (const group of tokenGroups) {
    const groupOk = group.some((term) => {
      const t = normalizePartSearchQuery(term);
      return ilikeIncludes(mei, t) || ilikeIncludes(cd, t);
    });
    if (!groupOk) return false;
  }
  return true;
}
