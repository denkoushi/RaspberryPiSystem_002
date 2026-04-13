import { useNavigate } from 'react-router-dom';

import { PartSearchCharPalette } from '../../features/mobile-placement/part-search/PartSearchCharPalette';
import { PartSearchHeaderToolbar } from '../../features/mobile-placement/part-search/PartSearchHeaderToolbar';
import { PART_SEARCH_SPACE_KEY } from '../../features/mobile-placement/part-search/partSearchPaletteDefinition';
import { PartSearchQueryInputs } from '../../features/mobile-placement/part-search/PartSearchQueryInputs';
import { PartSearchResultsSection } from '../../features/mobile-placement/part-search/PartSearchResultsSection';
import { PART_SEARCH_PALETTE_SCROLL_CLASS } from '../../features/mobile-placement/part-search/partSearchUiTokens';
import { useMobilePlacementPartSearch } from '../../features/mobile-placement/part-search/useMobilePlacementPartSearch';

/**
 * キオスク「部品名で棚を探す」ページ。状態は {@link useMobilePlacementPartSearch}、UI は子コンポーネントに分割。
 */
export function MobilePlacementPartSearchPage() {
  const navigate = useNavigate();
  const {
    partQuery,
    setPartQuery,
    machineQuery,
    setMachineQuery,
    setPaletteTarget,
    normalizedPartQuery,
    suggestQuery,
    visibleHits,
    hiddenPaletteKeys,
    selected,
    setSelected,
    clearSelection,
    appendFromPalette,
    backspaceFromPalette,
    showEmpty
  } = useMobilePlacementPartSearch();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-4 pt-2">
      <PartSearchHeaderToolbar
        title="部品名で棚を探す"
        showSpaceButton={!hiddenPaletteKeys.has(PART_SEARCH_SPACE_KEY)}
        onSpace={() => appendFromPalette(PART_SEARCH_SPACE_KEY)}
        onDelete={backspaceFromPalette}
        onBack={() => navigate('/kiosk/mobile-placement')}
      />

      <PartSearchQueryInputs
        partQuery={partQuery}
        machineQuery={machineQuery}
        onPartChange={setPartQuery}
        onMachineChange={setMachineQuery}
        onPartFocus={() => setPaletteTarget('part')}
        onMachineFocus={() => setPaletteTarget('machine')}
        onClearSelection={clearSelection}
      />

      <div className={PART_SEARCH_PALETTE_SCROLL_CLASS}>
        <PartSearchCharPalette hiddenKeys={hiddenPaletteKeys} onAppend={appendFromPalette} />
      </div>

      <PartSearchResultsSection
        normalizedPartQuery={normalizedPartQuery}
        suggestQuery={suggestQuery}
        showEmpty={showEmpty}
        visibleHits={visibleHits}
        selected={selected}
        onSelectHit={setSelected}
      />
    </div>
  );
}
