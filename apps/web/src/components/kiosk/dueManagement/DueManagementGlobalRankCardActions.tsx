import { DueManagementSelectionToggleButton } from './DueManagementSelectionToggleButton';

type DueManagementGlobalRankCardActionsProps = {
  isInTodayTriage: boolean;
  isOutOfToday: boolean;
  isCarryover: boolean;
  isSelected: boolean;
  onToggleSelection: () => void;
  selectionPending: boolean;
};

export function DueManagementGlobalRankCardActions({
  isInTodayTriage,
  isOutOfToday,
  isCarryover,
  isSelected,
  onToggleSelection,
  selectionPending
}: DueManagementGlobalRankCardActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {isInTodayTriage ? (
        <span className="rounded bg-blue-500/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-100">今日対象</span>
      ) : isOutOfToday ? (
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70">対象外</span>
      ) : null}
      {isCarryover ? (
        <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">引継ぎ</span>
      ) : null}
      <DueManagementSelectionToggleButton
        isSelected={isSelected}
        onToggle={onToggleSelection}
        disabled={selectionPending}
        size="compact"
      />
    </div>
  );
}
