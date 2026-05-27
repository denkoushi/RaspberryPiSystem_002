import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';
import { lbBtn, lbChip, lbChipClassName, lbText } from './loadBalancingUiClasses';

type ChipItem = {
  resourceCd: string;
  overMinutes: number;
  selected: boolean;
};

type Props = {
  chips: ChipItem[];
  suggestionsPending: boolean;
  overviewEnabled: boolean;
  hasSelectedOverResources: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSuggest: () => void;
  onToggle: (resourceCd: string) => void;
};

export function LoadBalancingOverviewResourceChips({
  chips,
  suggestionsPending,
  overviewEnabled,
  hasSelectedOverResources,
  onSelectAll,
  onClearSelection,
  onSuggest,
  onToggle
}: Props) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <LoadBalancingStepHeading step={2} className="mb-0">
          超過資源を選択
        </LoadBalancingStepHeading>
        <button
          type="button"
          className={`${lbBtn.base} ${lbBtn.sky}`}
          disabled={!overviewEnabled || suggestionsPending || !hasSelectedOverResources}
          onClick={onSuggest}
          title={hasSelectedOverResources ? undefined : '超過資源を1件以上選択してください'}
        >
          {suggestionsPending ? 'サジェスト計算中…' : '社内移管サジェスト'}
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button type="button" className={`${lbBtn.base} ${lbBtn.slateSm}`} onClick={onSelectAll}>
          超過資源をすべて選択
        </button>
        <button type="button" className={`${lbBtn.base} ${lbBtn.slateSm}`} onClick={onClearSelection}>
          選択解除
        </button>
      </div>
      {chips.length === 0 ? (
        <p className={lbText.muted}>超過資源はありません。</p>
      ) : (
        <div className={lbChip.grid}>
          {chips.map((chip) => (
            <button
              key={chip.resourceCd}
              type="button"
              aria-pressed={chip.selected}
              title={`${chip.resourceCd} (+${Math.round(chip.overMinutes)}分)`}
              className={lbChipClassName(chip.selected)}
              onClick={() => onToggle(chip.resourceCd)}
            >
              {chip.resourceCd} (+{Math.round(chip.overMinutes)}分)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
