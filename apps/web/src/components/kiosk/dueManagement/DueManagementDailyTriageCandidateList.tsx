import { formatDueDate } from '../../../features/kiosk/productionSchedule/formatDueDate';

import { DueManagementSelectionToggleButton } from './DueManagementSelectionToggleButton';

import type { ProductionScheduleDueManagementTriageItem } from '../../../api/client';

type DueManagementDailyTriageCandidateListProps = {
  loading: boolean;
  error: boolean;
  candidates: ProductionScheduleDueManagementTriageItem[];
  showSelectedOnly: boolean;
  onToggleShowSelectedOnly: () => void;
  onSelectFseiban: (fseiban: string) => void;
  onToggleSelection: (fseiban: string) => void;
  isSelected: (fseiban: string) => boolean;
  selectionPending: boolean;
};

export function DueManagementDailyTriageCandidateList({
  loading,
  error,
  candidates,
  showSelectedOnly,
  onToggleShowSelectedOnly,
  onSelectFseiban,
  onToggleSelection,
  isSelected,
  selectionPending
}: DueManagementDailyTriageCandidateListProps) {
  return (
    <div className="mb-3 rounded border border-white/15 bg-white/5 p-2">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-white">今日対象候補（トリアージ属性）</p>
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1 text-[10px] text-white hover:bg-slate-600"
          onClick={onToggleShowSelectedOnly}
        >
          {showSelectedOnly ? '全件表示' : '対象中のみ'}
        </button>
      </div>
      {loading ? <p className="text-[11px] text-white/70">候補を読み込み中...</p> : null}
      {error ? <p className="text-[11px] text-rose-300">候補取得に失敗しました</p> : null}
      {!loading && candidates.length === 0 ? (
        <p className="text-[11px] text-white/60">候補はありません（製番登録後にCSV反映を確認してください）</p>
      ) : null}
      <div className="space-y-1">
        {candidates.map((item) => {
          const zoneLabel = item.zone === 'danger' ? '危険' : item.zone === 'caution' ? '注意' : '余裕';
          const selected = isSelected(item.fseiban);
          return (
            <div key={`daily-candidate-${item.fseiban}`} className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5">
              <button type="button" className="text-left" onClick={() => onSelectFseiban(item.fseiban)}>
                <span className="text-[11px] font-semibold text-white">
                  {zoneLabel} / {item.fseiban}
                </span>
                <span className="ml-2 text-[10px] text-white/70">納期: {formatDueDate(item.dueDate)}</span>
              </button>
              <DueManagementSelectionToggleButton
                isSelected={selected}
                onToggle={() => onToggleSelection(item.fseiban)}
                disabled={selectionPending}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
