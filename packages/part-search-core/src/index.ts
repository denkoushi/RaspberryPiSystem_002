export { PART_SEARCH_ALIAS_GROUPS, expandSearchTerms } from './aliases.js';
export {
  hiraganaToKatakana,
  foldPartSearchKana,
  PART_SEARCH_KANA_FOLD_TRANSLATION,
  PART_SEARCH_KANA_FOLD_DELETE,
  katakanaToHiragana,
  mapSokuonToTsuForComparable,
  normalizeMachineNameForPartSearch,
  normalizePartSearchQuery,
  PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS,
  partSearchTermVariantsForIlike
} from './normalize.js';
export { buildTokenGroupsForSearch } from './token-groups.js';
export { matchesPartSearchFields } from './match.js';
export { buildPartSearchIndex, searchPartIndex, nextKeyAvailability } from './local-search.js';
export type { PartSearchRow, PartSearchField, PartSearchFilter, PartSearchQuery, PartSearchFacet, PartSearchIndex } from './local-search.js';
