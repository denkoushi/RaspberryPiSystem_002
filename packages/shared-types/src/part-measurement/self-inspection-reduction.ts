/**
 * 自主検査を段階的に減らす判定（減らせる検査）の正本ルール。
 *
 * API は承認記録の前にこの関数で再判定し、キオスクは Cpk 基準の切替を
 * 即時に反映するため同じ関数を使う。統計値の計算は API 側で行い、
 * ここでは計算済みの指標だけを受け取る。
 */

export type SelfInspectionReductionLevelMode = 'full' | 'fixed_count' | 'first_last' | 'single';

export type SelfInspectionReductionLevel = {
  mode: SelfInspectionReductionLevelMode;
  /** fixed_count のときだけ使う指定数。 */
  fixedCount: number | null;
};

export const SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS = [1.33, 1.67] as const;
export type SelfInspectionReductionCpkThreshold = (typeof SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS)[number];

/** これ未満の Cpk は公差からはみ出すおそれがあるため「戻す」。 */
export const SELF_INSPECTION_REDUCTION_CPK_RESTORE_BELOW = 1.0;
/** 1.67 基準のとき、1.33 以上は「もう少し」として扱う。 */
export const SELF_INSPECTION_REDUCTION_CPK_ALMOST_FROM = 1.33;
/** 作業者と検査員の測定差の許容（公差幅に対する平均絶対差の比）。 */
export const SELF_INSPECTION_REDUCTION_MAX_GAP_RATIO = 0.1;
/** 全数から1段下げるときに提案する指定数。実際の指定数は管理画面の改版で決める。 */
export const SELF_INSPECTION_REDUCTION_SUGGESTED_FIXED_COUNT = 5;

export const SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE = { min: 1, max: 50 } as const;
export const SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE = { min: 5, max: 200 } as const;

export type SelfInspectionReductionPolicy = {
  cpkThreshold: SelfInspectionReductionCpkThreshold;
  requiredConsecutiveLots: number;
  minimumSampleCount: number;
  resetStreakOnChangePoint: boolean;
};

export const DEFAULT_SELF_INSPECTION_REDUCTION_POLICY: SelfInspectionReductionPolicy = {
  cpkThreshold: 1.67,
  requiredConsecutiveLots: 10,
  minimumSampleCount: 30,
  resetStreakOnChangePoint: true
};

export function isSelfInspectionReductionCpkThreshold(value: number): value is SelfInspectionReductionCpkThreshold {
  return (SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS as readonly number[]).includes(value);
}

const LEVEL_RANK: Record<SelfInspectionReductionLevelMode, number> = {
  full: 0,
  fixed_count: 1,
  first_last: 2,
  single: 3
};

export function selfInspectionReductionLevelRank(level: SelfInspectionReductionLevel): number {
  return LEVEL_RANK[level.mode];
}

/** 1段軽い検査。これ以上軽くできないときは null。 */
export function lighterSelfInspectionLevel(
  level: SelfInspectionReductionLevel,
  lotSize: number
): SelfInspectionReductionLevel | null {
  const size = Math.max(Math.floor(lotSize), 1);
  switch (level.mode) {
    case 'full':
      if (size > SELF_INSPECTION_REDUCTION_SUGGESTED_FIXED_COUNT) {
        return { mode: 'fixed_count', fixedCount: SELF_INSPECTION_REDUCTION_SUGGESTED_FIXED_COUNT };
      }
      return size >= 2 ? { mode: 'first_last', fixedCount: null } : { mode: 'single', fixedCount: null };
    case 'fixed_count':
      return (level.fixedCount ?? 0) > 2 && size >= 2
        ? { mode: 'first_last', fixedCount: null }
        : { mode: 'single', fixedCount: null };
    case 'first_last':
      return { mode: 'single', fixedCount: null };
    case 'single':
    default:
      return null;
  }
}

/** 1段重い検査。全数より重い段はないので null。 */
export function heavierSelfInspectionLevel(
  level: SelfInspectionReductionLevel
): SelfInspectionReductionLevel | null {
  switch (level.mode) {
    case 'single':
      return { mode: 'first_last', fixedCount: null };
    case 'first_last':
      return { mode: 'fixed_count', fixedCount: SELF_INSPECTION_REDUCTION_SUGGESTED_FIXED_COUNT };
    case 'fixed_count':
      return { mode: 'full', fixedCount: null };
    case 'full':
    default:
      return null;
  }
}

/** 1ロットで測る個数。 */
export function selfInspectionPiecesPerLot(level: SelfInspectionReductionLevel, lotSize: number): number {
  const size = Math.max(Math.floor(lotSize), 1);
  switch (level.mode) {
    case 'fixed_count':
      return Math.min(Math.max(level.fixedCount ?? 1, 1), size);
    case 'first_last':
      return Math.min(2, size);
    case 'single':
      return 1;
    case 'full':
    default:
      return size;
  }
}

export function selfInspectionReductionLevelLabel(level: SelfInspectionReductionLevel): string {
  switch (level.mode) {
    case 'fixed_count':
      return `指定数 ${level.fixedCount ?? '—'}`;
    case 'first_last':
      return '最初と最後';
    case 'single':
      return '1件';
    case 'full':
    default:
      return '全数';
  }
}

export type SelfInspectionReductionMetrics = {
  level: SelfInspectionReductionLevel;
  lotSize: number;
  /** 公差の上下限がそろった数値項目があるか。 */
  evaluable: boolean;
  /** 最も厳しい項目の Cpk。計算できないときは null。 */
  worstCpk: number | null;
  /** 最も厳しい項目の測定個数。 */
  sampleCount: number;
  consecutivePassLots: number;
  /** 最新の変化点より後の連続合格。変化点がなければ null。 */
  consecutivePassLotsSinceChangePoint: number | null;
  drift: boolean;
  /** 作業者と検査員の差（公差幅比）。再測定がなければ null。 */
  measurementGapRatio: number | null;
  outOfToleranceCount: number;
  nonconformityCount: number;
};

export type SelfInspectionReductionCheckState = 'ok' | 'hold' | 'ng';

export type SelfInspectionReductionChecks = {
  sample: SelfInspectionReductionCheckState;
  cpk: SelfInspectionReductionCheckState;
  streak: SelfInspectionReductionCheckState;
  drift: SelfInspectionReductionCheckState;
  gap: SelfInspectionReductionCheckState;
  quality: SelfInspectionReductionCheckState;
};

export type SelfInspectionReductionVerdict = 'reduce' | 'almost' | 'keep' | 'restore' | 'unjudgeable';

export const SELF_INSPECTION_REDUCTION_VERDICT_LABELS: Record<SelfInspectionReductionVerdict, string> = {
  reduce: '減らせる',
  almost: 'もう少し',
  keep: 'このまま',
  restore: '戻す',
  unjudgeable: '判定できない'
};

export type SelfInspectionReductionJudgement = {
  verdict: SelfInspectionReductionVerdict;
  checks: SelfInspectionReductionChecks;
  /** 判定に使った連続合格（設定により変化点から数え直した値）。 */
  effectiveConsecutivePassLots: number;
  /** reduce なら1段軽い段、restore なら1段重い段。 */
  target: SelfInspectionReductionLevel | null;
};

export function judgeSelfInspectionReduction(
  metrics: SelfInspectionReductionMetrics,
  policy: SelfInspectionReductionPolicy
): SelfInspectionReductionJudgement {
  const effectiveConsecutivePassLots =
    policy.resetStreakOnChangePoint && metrics.consecutivePassLotsSinceChangePoint != null
      ? metrics.consecutivePassLotsSinceChangePoint
      : metrics.consecutivePassLots;
  const enoughSample = metrics.sampleCount >= policy.minimumSampleCount;

  let cpk: SelfInspectionReductionCheckState;
  if (metrics.worstCpk == null || !enoughSample) {
    cpk = 'hold';
  } else if (metrics.worstCpk >= policy.cpkThreshold) {
    cpk = 'ok';
  } else if (metrics.worstCpk >= SELF_INSPECTION_REDUCTION_CPK_ALMOST_FROM) {
    cpk = 'hold';
  } else {
    cpk = 'ng';
  }

  const checks: SelfInspectionReductionChecks = {
    sample: enoughSample ? 'ok' : 'hold',
    cpk,
    streak: effectiveConsecutivePassLots >= policy.requiredConsecutiveLots ? 'ok' : 'hold',
    drift: metrics.drift ? 'ng' : 'ok',
    gap:
      metrics.measurementGapRatio == null
        ? 'hold'
        : metrics.measurementGapRatio <= SELF_INSPECTION_REDUCTION_MAX_GAP_RATIO
          ? 'ok'
          : 'ng',
    quality: metrics.outOfToleranceCount === 0 && metrics.nonconformityCount === 0 ? 'ok' : 'ng'
  };

  const restore =
    checks.quality === 'ng' ||
    (enoughSample && metrics.worstCpk != null && metrics.worstCpk < SELF_INSPECTION_REDUCTION_CPK_RESTORE_BELOW);

  let verdict: SelfInspectionReductionVerdict;
  if (restore) {
    verdict = 'restore';
  } else if (!metrics.evaluable) {
    verdict = 'unjudgeable';
  } else {
    const states = Object.values(checks);
    if (states.includes('ng')) {
      verdict = 'keep';
    } else if (states.every((state) => state === 'ok')) {
      verdict = lighterSelfInspectionLevel(metrics.level, metrics.lotSize) ? 'reduce' : 'keep';
    } else {
      verdict = 'almost';
    }
  }

  const target =
    verdict === 'reduce'
      ? lighterSelfInspectionLevel(metrics.level, metrics.lotSize)
      : verdict === 'restore'
        ? heavierSelfInspectionLevel(metrics.level)
        : null;

  return { verdict, checks, effectiveConsecutivePassLots, target };
}
