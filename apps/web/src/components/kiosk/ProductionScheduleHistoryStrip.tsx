import { SeibanHistoryButton } from './SeibanHistoryButton';

type HistoryProgress = {
  status?: string;
  machineName?: string | null;
};

type ProductionScheduleHistoryStripProps = {
  visibleHistory: string[];
  normalizedActiveQueries: string[];
  progressBySeiban: Record<string, HistoryProgress>;
  onToggleHistoryQuery: (seiban: string) => void;
  onConfirmRemoveHistoryQuery: (seiban: string) => void;
  onMoveHistoryLeft: (seiban: string) => void;
  onMoveHistoryRight: (seiban: string) => void;
};

export function ProductionScheduleHistoryStrip({
  visibleHistory,
  normalizedActiveQueries,
  progressBySeiban,
  onToggleHistoryQuery,
  onConfirmRemoveHistoryQuery,
  onMoveHistoryLeft,
  onMoveHistoryRight
}: ProductionScheduleHistoryStripProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {visibleHistory.map((seiban, index) => {
        const isActive = normalizedActiveQueries.includes(seiban);
        const progress = progressBySeiban[seiban];
        const isComplete = progress?.status === 'complete';
        return (
          <SeibanHistoryButton
            key={seiban}
            seiban={seiban}
            machineName={progress?.machineName}
            isActive={isActive}
            isComplete={isComplete}
            canMoveLeft={index > 0}
            canMoveRight={index < visibleHistory.length - 1}
            onToggle={() => onToggleHistoryQuery(seiban)}
            onRemove={() => onConfirmRemoveHistoryQuery(seiban)}
            onMoveLeft={() => onMoveHistoryLeft(seiban)}
            onMoveRight={() => onMoveHistoryRight(seiban)}
          />
        );
      })}
    </div>
  );
}
