import { normalizePartSearchQuery } from '@raspi-system/part-search-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getMobilePlacementPartSearchSuggest } from '../../../api/client';

import { partSearchHitIdentity } from './partSearchIdentity';
import { PART_SEARCH_PALETTE_KEYS } from './partSearchPaletteDefinition';
import { computeHiddenPaletteKeys } from './partSearchPalettePruner';
import { selectRegisteredPlacementHits } from './partSearchViewModel';

import type { PartPlacementSearchHitDto } from './types';

export type PartSearchPaletteTarget = 'part' | 'machine';

/**
 * 入力・API・登録済み候補・剪定・選択を分離した検索画面用フック。
 * 部品名（FHINMEI/FHINCD）と機種名（MH/SH の機種表示）を AND で API に渡す。
 */
export function useMobilePlacementPartSearch() {
  const [partQuery, setPartQuery] = useState('');
  const [machineQuery, setMachineQuery] = useState('');
  const [paletteTarget, setPaletteTarget] = useState<PartSearchPaletteTarget>('part');
  const [selected, setSelected] = useState<PartPlacementSearchHitDto | null>(null);

  const normalizedPartQuery = useMemo(() => normalizePartSearchQuery(partQuery), [partQuery]);
  const machineQueryTrimmed = useMemo(() => machineQuery.trim(), [machineQuery]);

  const suggestQuery = useQuery({
    queryKey: ['mobile-placement-part-search', normalizedPartQuery, machineQueryTrimmed],
    queryFn: () =>
      getMobilePlacementPartSearchSuggest(
        normalizedPartQuery,
        machineQueryTrimmed.length > 0 ? machineQueryTrimmed : undefined
      ),
    enabled: normalizedPartQuery.length > 0
  });

  const visibleHits = useMemo(
    () => selectRegisteredPlacementHits(suggestQuery.data),
    [suggestQuery.data]
  );

  const hiddenPaletteKeys = useMemo(() => {
    if (suggestQuery.isFetching) {
      return new Set<string>();
    }
    /** 機種名欄ではヒットに機種表示名が無いため剪定しない（誤ってボタンを消さない） */
    if (paletteTarget === 'machine') {
      return new Set<string>();
    }
    return computeHiddenPaletteKeys(normalizedPartQuery, visibleHits, PART_SEARCH_PALETTE_KEYS);
  }, [normalizedPartQuery, visibleHits, suggestQuery.isFetching, paletteTarget]);

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
    partQuery,
    setPartQuery,
    machineQuery,
    setMachineQuery,
    paletteTarget,
    setPaletteTarget,
    normalizedPartQuery,
    suggestQuery,
    visibleHits,
    hiddenPaletteKeys,
    selected,
    setSelected,
    clearSelection
  };
}
