import { normalizePartSearchQuery } from '@raspi-system/part-search-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getMobilePlacementPartSearchSuggest } from '../../../api/client';

import { partSearchHitIdentity } from './partSearchIdentity';
import { PART_SEARCH_PALETTE_KEYS } from './partSearchPaletteDefinition';
import { computeHiddenPaletteKeys } from './partSearchPalettePruner';
import { selectRegisteredPlacementHits } from './partSearchViewModel';

import type { PartPlacementSearchHitDto } from './types';

/**
 * 入力・API・登録済み候補・剪定・選択を分離した検索画面用フック。
 */
export function useMobilePlacementPartSearch() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PartPlacementSearchHitDto | null>(null);

  const normalizedQuery = useMemo(() => normalizePartSearchQuery(query), [query]);

  const suggestQuery = useQuery({
    queryKey: ['mobile-placement-part-search', normalizedQuery],
    queryFn: () => getMobilePlacementPartSearchSuggest(normalizedQuery),
    enabled: normalizedQuery.length > 0
  });

  const visibleHits = useMemo(
    () => selectRegisteredPlacementHits(suggestQuery.data),
    [suggestQuery.data]
  );

  const hiddenPaletteKeys = useMemo(() => {
    if (suggestQuery.isFetching) {
      return new Set<string>();
    }
    return computeHiddenPaletteKeys(normalizedQuery, visibleHits, PART_SEARCH_PALETTE_KEYS);
  }, [normalizedQuery, visibleHits, suggestQuery.isFetching]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const selectedId = partSearchHitIdentity(selected);
    const stillVisible = visibleHits.some((hit) => partSearchHitIdentity(hit) === selectedId);
    if (!stillVisible) {
      setSelected(null);
    }
  }, [selected, visibleHits]);

  const clearSelection = () => setSelected(null);

  return {
    query,
    setQuery,
    normalizedQuery,
    suggestQuery,
    visibleHits,
    hiddenPaletteKeys,
    selected,
    setSelected,
    clearSelection
  };
}
