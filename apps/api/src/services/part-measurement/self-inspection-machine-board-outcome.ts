/**
 * 自主検査サイネージの表示結果を決める純粋な業務ルール。
 *
 * このモジュールは Prisma / SelfInspectionService へ依存しない。DB の列値は
 * repository 境界でこの入力へ変換してから渡すこと。
 */

export type SelfInspectionMachineBoardOutcomeStatus =
  | 'rejected'
  | 'pending'
  | 'in_progress'
  | 'pass'
  | 'not_started';

/** 同一 measurement value の判定列。配列の index をまたいで APPROVED を適用しない。 */
export type SelfInspectionMachineBoardMeasurementOutcome = {
  judgementResult?: string | null;
  reviewStatus?: string | null;
  finalReviewStatus?: string | null;
  inspectorJudgementStatus?: string | null;
};

export type SelfInspectionMachineBoardOutcomeInput = {
  /** CONFIRMED の entry 数。未指定時は completedEntryCount を使用する。 */
  confirmedEntryCount?: number | null;
  completedEntryCount?: number | null;
  /** 資源単位で解決済みの必要 entry 数。 */
  requiredEntryCount?: number | null;
  /** 完了時刻は旧形式セッションの完了判定にも使う。 */
  completedAt?: Date | null;
  /** DRAFT を含む entry の存在を必要とする旧形式用の補助値。 */
  hasAnyLotEntry?: boolean | null;
  /** repository で集計した明示的な判定件数。 */
  pendingReviewCount?: number | null;
  directFailCount?: number | null;
  rejectedCount?: number | null;
  /** DB の判定列をそのまま渡せるよう、文字列配列も受け付ける。 */
  judgementResults?: Array<string | null | undefined>;
  reviewStatuses?: Array<string | null | undefined>;
  finalReviewStatuses?: Array<string | null | undefined>;
  inspectorJudgementStatuses?: Array<string | null | undefined>;
  /** 判定列を同一 measurement value 単位で保持した正規形。 */
  measurementOutcomes?: SelfInspectionMachineBoardMeasurementOutcome[];
  /** decoration の旧 status を repository 未取得時の fallback に使う。 */
  legacyStatus?: string | null;
};

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function hasStatus(values: Array<string | null | undefined> | undefined, expected: string): boolean {
  return (values ?? []).some((value) => normalizeStatus(value) === expected);
}

function hasAnyStatus(
  values: Array<string | null | undefined> | undefined,
  expected: readonly string[]
): boolean {
  const expectedSet = new Set(expected);
  return (values ?? []).some((value) => expectedSet.has(normalizeStatus(value)));
}

function measurementOutcomesForInput(
  input: SelfInspectionMachineBoardOutcomeInput
): SelfInspectionMachineBoardMeasurementOutcome[] {
  if (input.measurementOutcomes && input.measurementOutcomes.length > 0) {
    return input.measurementOutcomes;
  }

  const length = Math.max(
    input.judgementResults?.length ?? 0,
    input.reviewStatuses?.length ?? 0,
    input.finalReviewStatuses?.length ?? 0,
    input.inspectorJudgementStatuses?.length ?? 0
  );
  return Array.from({ length }, (_, index) => ({
    judgementResult: input.judgementResults?.[index],
    reviewStatus: input.reviewStatuses?.[index],
    finalReviewStatus: input.finalReviewStatuses?.[index],
    inspectorJudgementStatus: input.inspectorJudgementStatuses?.[index],
  }));
}

function finiteNonNegative(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
}

/**
 * 判定列と進捗数からカード状態を解決する。
 *
 * 優先順位は rejected/direct FAIL > PENDING > in-progress > pass > not-started。
 * `APPROVED` は PENDING ではなく、必要件数がそろった場合に pass を妨げない。
 */
export function resolveSelfInspectionMachineBoardOutcome(
  input: SelfInspectionMachineBoardOutcomeInput
): SelfInspectionMachineBoardOutcomeStatus {
  const confirmedEntryCount = finiteNonNegative(
    input.confirmedEntryCount ?? input.completedEntryCount,
    0
  );
  const requiredEntryCount = Math.max(1, finiteNonNegative(input.requiredEntryCount, 1));

  const directFail =
    finiteNonNegative(input.directFailCount, 0) > 0 ||
    hasStatus(input.judgementResults, 'FAIL') ||
    measurementOutcomesForInput(input).some(
      (value) => normalizeStatus(value.judgementResult) === 'FAIL'
    );
  const measurementOutcomes = measurementOutcomesForInput(input);
  const rejected =
    finiteNonNegative(input.rejectedCount, 0) > 0 ||
    hasAnyStatus(input.finalReviewStatuses, ['REJECTED', 'FAIL', 'NG']) ||
    hasAnyStatus(input.inspectorJudgementStatuses, ['REJECTED', 'FAIL', 'NG']) ||
    measurementOutcomes.some(
      (value) =>
        ['REJECTED', 'FAIL', 'NG'].includes(normalizeStatus(value.finalReviewStatus)) ||
        ['REJECTED', 'FAIL', 'NG'].includes(normalizeStatus(value.inspectorJudgementStatus))
    );

  if (rejected || directFail) {
    return 'rejected';
  }

  // finalReviewStatus がある場合は同じ measurement value の reviewStatus にだけ
  // 適用する。別 value の APPROVED が全体の PENDING を抑止しないようにする。
  const pending =
    finiteNonNegative(input.pendingReviewCount, 0) > 0 ||
    measurementOutcomes.some((value) => {
      const finalStatus = normalizeStatus(value.finalReviewStatus);
      if (finalStatus === 'PENDING') {
        return true;
      }
      if (finalStatus === 'APPROVED') {
        return false;
      }
      return normalizeStatus(value.reviewStatus) === 'PENDING';
    });

  if (pending) {
    return 'pending';
  }

  const legacy = normalizeStatus(input.legacyStatus);
  const legacyCompleted = legacy === 'COMPLETED' || legacy === 'PASS';
  const legacyHasEntry =
    legacy === 'IN_PROGRESS' || legacy === 'REVIEW_PENDING' || input.hasAnyLotEntry === true;
  const isComplete =
    confirmedEntryCount >= requiredEntryCount || input.completedAt != null || legacyCompleted;

  if (isComplete) {
    return 'pass';
  }
  if (confirmedEntryCount > 0 || legacyHasEntry) {
    return 'in_progress';
  }
  return 'not_started';
}

/** Short alias used by aggregation callers. */
export const resolveMachineBoardOutcome = resolveSelfInspectionMachineBoardOutcome;

/** Legacy-friendly alias for tests and callers outside the board service. */
export const resolveSelfInspectionBoardOutcome = resolveSelfInspectionMachineBoardOutcome;
