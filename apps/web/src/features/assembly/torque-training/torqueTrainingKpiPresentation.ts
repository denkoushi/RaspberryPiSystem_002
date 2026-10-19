/**
 * 訓練KPIの表示用整形。API型に依存せず、数値だけを受け取る。
 * 値が無いときは「—」を返し、画面側で分岐しなくて済むようにする。
 */

export const NO_VALUE = '—';

export type TorqueTrainingTendencyTone = 'center' | 'weak' | 'strong' | 'none';

export type TorqueTrainingTendency = {
  label: string;
  tone: TorqueTrainingTendencyTone;
  /** 符号付きの平均（例: "−1.6%"）。 */
  signedLabel: string;
};

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 0〜1 の合格率を整数の%表記にする（例: 0.84 → "84"）。 */
export function formatTrainingRate(rate: number | null | undefined): string {
  return isNumber(rate) ? String(Math.round(rate * 100)) : NO_VALUE;
}

/** %値を小数1桁にする（例: 5.23 → "5.2"）。 */
export function formatTrainingPercent(value: number | null | undefined): string {
  return isNumber(value) ? value.toFixed(1) : NO_VALUE;
}

export function formatSignedTrainingPercent(value: number | null | undefined): string {
  if (!isNumber(value)) return NO_VALUE;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '±0.0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`;
}

/**
 * 符号付き平均ずれから「強め/弱め」を決める。
 * ±1%未満は中央、±3%未満は「やや」、それ以上は言い切る。
 */
export function trainingTendency(meanDeviationPercent: number | null | undefined): TorqueTrainingTendency {
  if (!isNumber(meanDeviationPercent)) return { label: NO_VALUE, tone: 'none', signedLabel: NO_VALUE };
  const signedLabel = formatSignedTrainingPercent(meanDeviationPercent);
  const size = Math.abs(meanDeviationPercent);
  if (size < 1) return { label: 'ほぼ中央', tone: 'center', signedLabel };
  const direction = meanDeviationPercent < 0 ? '弱め' : '強め';
  return {
    label: size < 3 ? `やや${direction}` : direction,
    tone: meanDeviationPercent < 0 ? 'weak' : 'strong',
    signedLabel
  };
}

export type TorqueTrainingDelta = { label: string; improved: boolean | null };

/** 合格率の差をポイントで表す（高いほど良い）。 */
export function trainingRateDelta(recent: number | null | undefined, allTime: number | null | undefined): TorqueTrainingDelta | null {
  if (!isNumber(recent) || !isNumber(allTime)) return null;
  const points = Math.round((recent - allTime) * 100);
  if (points === 0) return { label: '± 0pt', improved: null };
  return { label: `${points > 0 ? '▲' : '▼'} ${Math.abs(points)}pt`, improved: points > 0 };
}

/** 平均ずれの差をポイントで表す（低いほど良い）。 */
export function trainingErrorDelta(recent: number | null | undefined, allTime: number | null | undefined): TorqueTrainingDelta | null {
  if (!isNumber(recent) || !isNumber(allTime)) return null;
  const points = Math.round((recent - allTime) * 10) / 10;
  if (points === 0) return { label: '± 0.0pt', improved: null };
  return { label: `${points > 0 ? '▲' : '▼'} ${Math.abs(points).toFixed(1)}pt`, improved: points < 0 };
}

/** 合格率と本数から合格本数を戻す。 */
export function passedTrainingAttempts(attemptCount: number, passRate: number): number {
  return Math.round(attemptCount * passRate);
}

export type TorqueTrainingSessionAttemptLike = {
  accepted: boolean;
  judgement: 'OK' | 'UNDER' | 'OVER' | 'IGNORED';
  deviationPercent: string | null;
  absoluteDeviationPercent: string | null;
};

/** 1回分の結果をサーバーの指標と同じ規則（採用済み・差あり）でまとめる。 */
export function summarizeTrainingSessionAttempts(attempts: TorqueTrainingSessionAttemptLike[]) {
  const counted = attempts.filter((attempt) => attempt.accepted && attempt.deviationPercent !== null && attempt.deviationPercent !== '');
  const signed = counted.map((attempt) => Number(attempt.deviationPercent));
  const absolute = counted.map((attempt) => Number(attempt.absoluteDeviationPercent ?? Math.abs(Number(attempt.deviationPercent))));
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    okCount: attempts.filter((attempt) => attempt.accepted && attempt.judgement === 'OK').length,
    meanAbsoluteErrorPercent: mean(absolute),
    meanDeviationPercent: mean(signed)
  };
}
