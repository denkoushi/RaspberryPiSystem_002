/**
 * 減らせる検査の統計計算。Prisma に依存しない純粋関数だけを置く。
 */

/** Cpk が極端に大きい（ばらつきゼロ）場合の表示上限。 */
export const REDUCTION_CPK_CAP = 9.99;
/** ずれの判定に使う直近の個数と、判定に必要な最小個数。 */
export const REDUCTION_DRIFT_RECENT_COUNT = 10;
export const REDUCTION_DRIFT_MIN_COUNT = 20;
/** 直近平均と過去平均の差が公差幅のこの割合以上なら「ずれていく傾向」。 */
export const REDUCTION_DRIFT_TOLERANCE_RATIO = 0.125;

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function sampleStandardDeviation(values: readonly number[]): number | null {
  const m = mean(values);
  if (m == null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export type ToleranceLimits = { lower: number; upper: number };

export function computeCpk(values: readonly number[], limits: ToleranceLimits): number | null {
  const m = mean(values);
  const sd = sampleStandardDeviation(values);
  if (m == null || sd == null) return null;
  const nearest = Math.min(limits.upper - m, m - limits.lower);
  if (sd === 0) {
    return nearest >= 0 ? REDUCTION_CPK_CAP : 0;
  }
  return Math.min(nearest / (3 * sd), REDUCTION_CPK_CAP);
}

export function isOutOfTolerance(value: number, limits: ToleranceLimits): boolean {
  return value < limits.lower || value > limits.upper;
}

/** 時系列順の値について、直近の平均が過去の平均から公差幅の一定割合以上離れたか。 */
export function detectDrift(valuesInTimeOrder: readonly number[], limits: ToleranceLimits): boolean {
  if (valuesInTimeOrder.length < REDUCTION_DRIFT_MIN_COUNT) return false;
  const recent = valuesInTimeOrder.slice(-REDUCTION_DRIFT_RECENT_COUNT);
  const earlier = valuesInTimeOrder.slice(0, -REDUCTION_DRIFT_RECENT_COUNT);
  const recentMean = mean(recent);
  const earlierMean = mean(earlier);
  if (recentMean == null || earlierMean == null) return false;
  return Math.abs(recentMean - earlierMean) >= (limits.upper - limits.lower) * REDUCTION_DRIFT_TOLERANCE_RATIO;
}

/** 古い順のロット合否から、最新側で連続した合格ロット数を数える。 */
export function countTrailingPasses(passesOldestFirst: readonly boolean[]): number {
  let count = 0;
  for (let index = passesOldestFirst.length - 1; index >= 0; index -= 1) {
    if (!passesOldestFirst[index]) break;
    count += 1;
  }
  return count;
}

/** 作業者と検査員の平均絶対差を公差幅で割った比。 */
export function measurementGapRatio(
  pairs: ReadonlyArray<{ operator: number; inspector: number }>,
  limits: ToleranceLimits
): number | null {
  const width = limits.upper - limits.lower;
  if (pairs.length === 0 || width <= 0) return null;
  const meanAbsDiff = mean(pairs.map((pair) => Math.abs(pair.inspector - pair.operator)));
  return meanAbsDiff == null ? null : meanAbsDiff / width;
}

/**
 * テンプレート改版で項目 id が変わるため、版をまたいで同じ測定項目を
 * 追いかけるための文字列キー。
 */
export function stableTemplateItemKey(item: {
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
}): string {
  return [item.datumSurface, item.measurementPoint, item.measurementLabel]
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .join('|');
}
