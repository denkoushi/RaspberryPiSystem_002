import { isConfirmed } from './self-inspection/entry-persistence-status.js';
import { resolveRequiredEntryCountForCompletion } from './self-inspection/shared.js';
import type { ProductionScheduleResourceNameMap } from '../production-schedule/resource-master.service.js';
import type { SelfInspectionMachineBoardMeasurementOutcome } from './self-inspection-machine-board-outcome.js';
import type { SelfInspectionMachineBoardAggregationRow } from './self-inspection-machine-board-aggregation.js';
import type { SelfInspectionMachineBoardActiveSession } from './self-inspection-machine-board-active.repository.js';
import { resolveSelfInspectionMachineBoardResourceDisplayName } from './self-inspection-machine-board-resource-name.js';

export { resolveSelfInspectionMachineBoardResourceDisplayName } from './self-inspection-machine-board-resource-name.js';

export type SelfInspectionMachineBoardActiveSessionTransformOptions = {
  /** session.machineName が未保存／未登録のときに使う製番別 fallback。 */
  machineNameByFseiban?: Readonly<Record<string, string | null | undefined>>;
  /** 資源CDごとの日本語名。未登録時は CD 自体へ fallback する。 */
  resourceNameMap?: ProductionScheduleResourceNameMap;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeResourceCd(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase();
}

function finiteNonNegative(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
}

function resolveMachineName(
  session: SelfInspectionMachineBoardActiveSession,
  machineNameByFseiban: Readonly<Record<string, string | null | undefined>> | undefined
): string | null {
  const snapshot = normalizeText(session.machineName);
  if (snapshot.length > 0) {
    return snapshot;
  }
  const fseiban = normalizeText(session.fseiban);
  const fallback = normalizeText(fseiban ? machineNameByFseiban?.[fseiban] : undefined);
  return fallback.length > 0 ? fallback : null;
}

function toOutcomeInput(
  session: SelfInspectionMachineBoardActiveSession,
  requiredEntryCount: number
) {
  const confirmedEntries = session.entries.filter((entry) => isConfirmed(entry.persistenceStatus));
  const values = confirmedEntries.flatMap((entry) => entry.values);
  const pendingReviewCount = values.filter((value) => {
    const finalStatus = normalizeText(value.finalReviewStatus).toUpperCase();
    return finalStatus.length > 0 ? finalStatus === 'PENDING' : value.reviewStatus === 'PENDING';
  }).length;
  const directFailCount = values.filter((value) => value.judgementResult === 'FAIL').length;
  const rejectedCount = values.filter((value) => {
    const finalStatus = normalizeText(value.finalReviewStatus).toUpperCase();
    return finalStatus === 'REJECTED' || finalStatus === 'FAIL' || finalStatus === 'NG';
  }).length;
  const measurementOutcomes: SelfInspectionMachineBoardMeasurementOutcome[] = values.map(
    (value) => ({
      judgementResult: value.judgementResult,
      reviewStatus: value.reviewStatus,
      finalReviewStatus: value.finalReviewStatus,
    })
  );
  return {
    confirmedEntryCount: confirmedEntries.length,
    completedEntryCount: confirmedEntries.length,
    requiredEntryCount,
    completedAt: session.completedAt,
    hasAnyLotEntry: session.entries.length > 0,
    pendingReviewCount,
    directFailCount,
    rejectedCount,
    judgementResults: values.map((value) => value.judgementResult),
    reviewStatuses: values.map((value) => value.reviewStatus),
    finalReviewStatuses: values.map((value) => value.finalReviewStatus),
    measurementOutcomes,
  };
}

/**
 * active session snapshot を既存カード集約の入力へ変換する DB 非依存関数。
 *
 * セッションの `machineName` は開始時 snapshot を優先し、欠損時だけ製番 lookup
 * を使う。DRAFT は active の存在判定へ残し、CONFIRMED entry とその値だけを
 * 進捗・判定列へ渡す。
 */
export function mapSelfInspectionMachineBoardActiveSessionsToAggregationRows(
  sessions: readonly SelfInspectionMachineBoardActiveSession[],
  options: SelfInspectionMachineBoardActiveSessionTransformOptions = {}
): SelfInspectionMachineBoardAggregationRow[] {
  return sessions.map((session) => {
    const fseiban = normalizeText(session.fseiban);
    const resourceCd = normalizeResourceCd(session.resourceCd);
    const requiredEntryCount = Math.max(
      1,
      finiteNonNegative(
        resolveRequiredEntryCountForCompletion({
          expectedEntryCount: session.expectedEntryCount,
          plannedQuantity: session.plannedQuantity,
          template: session.template,
        }),
        1
      )
    );
    const confirmedEntryCount = session.entries.filter((entry) =>
      isConfirmed(entry.persistenceStatus)
    ).length;
    const scheduleRowId = normalizeText(session.scheduleRowId) || `active-session:${session.id}`;
    const machineName = resolveMachineName(session, options.machineNameByFseiban);
    const outcome = toOutcomeInput(session, requiredEntryCount);

    return {
      scheduleRowId,
      fseiban,
      productNo: normalizeText(session.productNo),
      fhincd: normalizeText(session.fhincd),
      fhinmei: normalizeText(session.fhinmei) || normalizeText(session.fhincd),
      machineName,
      normalizedMachineName: undefined,
      resourceCd,
      resourceDisplayName: resolveSelfInspectionMachineBoardResourceDisplayName(
        resourceCd,
        options.resourceNameMap
      ),
      dueDate: null,
      isScheduled: false,
      confirmedEntryCount,
      completedEntryCount: confirmedEntryCount,
      requiredEntryCount,
      outcome,
      updatedAt: session.updatedAt,
      sessionId: session.id,
    };
  });
}

export const buildSelfInspectionMachineBoardActiveAggregationRows =
  mapSelfInspectionMachineBoardActiveSessionsToAggregationRows;
