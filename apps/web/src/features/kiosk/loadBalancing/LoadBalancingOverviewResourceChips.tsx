import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';

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
        <LoadBalancingStepHeading step={2}>超過資源を選択</LoadBalancingStepHeading>
        <button
          type="button"
          className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
          disabled={!overviewEnabled || suggestionsPending || !hasSelectedOverResources}
          onClick={onSuggest}
          title={hasSelectedOverResources ? undefined : '超過資源を1件以上選択してください'}
        >
          {suggestionsPending ? 'サジェスト計算中…' : '社内移管サジェスト'}
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white"
          onClick={onSelectAll}
        >
          超過資源をすべて選択
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white"
          onClick={onClearSelection}
        >
          選択解除
        </button>
      </div>
      {chips.length === 0 ? (
        <p className="text-xs text-white/60">超過資源はありません。</p>
      ) : (
        <div className="grid max-h-[114px] min-h-[34px] grid-cols-[repeat(auto-fill,minmax(102px,1fr))] gap-1.5 overflow-auto pr-0.5">
          {chips.map((chip) => (
            <button
              key={chip.resourceCd}
              type="button"
              aria-pressed={chip.selected}
              title={`${chip.resourceCd} (+${Math.round(chip.overMinutes)}分)`}
              className={`truncate rounded-md px-2 py-1.5 text-[11px] font-mono ${
                chip.selected ? 'bg-amber-600 text-white' : 'bg-slate-800 text-white/80'
              }`}
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
