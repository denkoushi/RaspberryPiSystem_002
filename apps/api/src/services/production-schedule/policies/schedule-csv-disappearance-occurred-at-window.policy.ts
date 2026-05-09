/**
 * 生産日程CSV取り込みに連動する「消滅完了」判定の `CsvDashboardRow.occurredAt` 窓。
 *
 * 運用上、生産日程はおよそ **過去3か月〜先3か月**、FKOJUNST はより広いレンジで届く前提。
 * 窓外の FKOJUNST 行を消滅候補に含めないため、母集団を生産日程側の観測レンジに揃える。
 */
export const SCHEDULE_CSV_DISAPPEARANCE_WINDOW_MONTHS_BEFORE = 3;
export const SCHEDULE_CSV_DISAPPEARANCE_WINDOW_MONTHS_AFTER = 3;

export function computeProductionScheduleDisappearanceOccurredAtBounds(referenceAt: Date): {
  windowStart: Date;
  windowEnd: Date;
} {
  const windowStart = new Date(referenceAt.getTime());
  windowStart.setUTCMonth(
    windowStart.getUTCMonth() - SCHEDULE_CSV_DISAPPEARANCE_WINDOW_MONTHS_BEFORE
  );

  const windowEnd = new Date(referenceAt.getTime());
  windowEnd.setUTCMonth(
    windowEnd.getUTCMonth() + SCHEDULE_CSV_DISAPPEARANCE_WINDOW_MONTHS_AFTER
  );

  return { windowStart, windowEnd };
}
