import { matchesPartSearchFields } from '@raspi-system/part-search-core';

import type { PartPlacementSearchHitDto } from './types';

/**
 * 現在の検索語に各文字を足したとき、表示中のヒットのいずれかにまだ一致し得るかでボタンを剪定する。
 * ヒット 0 件のときは剪定しない（すべて表示）。
 */
export function computeHiddenPaletteKeys(
  currentQuery: string,
  hits: readonly PartPlacementSearchHitDto[],
  paletteKeys: readonly string[]
): Set<string> {
  const hidden = new Set<string>();
  if (hits.length === 0) {
    return hidden;
  }
  for (const key of paletteKeys) {
    const nextQuery = currentQuery + key;
    const stillPossible = hits.some((h) =>
      matchesPartSearchFields({ fhinmei: h.fhinmei, fhincd: h.fhincd }, nextQuery)
    );
    if (!stillPossible) {
      hidden.add(key);
    }
  }
  return hidden;
}
