import type { TorqueTrainingProgramVersionApi } from '../../../api/client';

export type TorqueTrainingWrenchPreparationTarget = Pick<
  TorqueTrainingProgramVersionApi,
  'nominalDiameter' | 'boltLengthMm' | 'material' | 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'
>;

const SETUP_REASON_LABELS: Readonly<Record<string, string>> = {
  NO_ASSIGNED_WRENCH: '対応レンチ未登録',
  WRONG_CAPABILITY_GROUP: '適合グループが一致しません',
  MODEL_RANGE_NOT_COVERED: '型番の測定範囲が不足しています',
  INSTRUMENT_STATUS_NOT_ELIGIBLE: 'レンチが使用可能な状態ではありません',
  CALIBRATION_MISSING: '校正期限が登録されていません',
  CALIBRATION_EXPIRED: '校正期限が切れています'
};

export function presentTorqueTrainingSetupReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return SETUP_REASON_LABELS[reason] ?? reason;
}

/** Keep values readable without changing the server's source of truth. */
export function formatTorqueTrainingValue(value: string | number | null | undefined, unit: string): string {
  if (value === null || value === undefined || value === '') return `- ${formatTorqueTrainingUnit(unit)}`;
  const numeric = typeof value === 'number' ? value : Number(value);
  const displayValue = Number.isFinite(numeric) ? String(numeric) : String(value);
  return `${displayValue} ${formatTorqueTrainingUnit(unit)}`;
}

export function formatTorqueTrainingUnit(unit: string): string {
  return unit === 'N-m' || unit === 'Nm' ? 'N·m' : unit;
}

export function formatTorqueTrainingBoltLength(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return `${value} mm`;
}

export function preparationTargetRows(target: TorqueTrainingWrenchPreparationTarget) {
  return [
    { key: 'nominalDiameter', label: '呼び径', value: target.nominalDiameter },
    { key: 'material', label: '材質', value: target.material },
    { key: 'boltLengthMm', label: '首下長さ', value: formatTorqueTrainingBoltLength(target.boltLengthMm) },
    { key: 'lowerLimit', label: '下限', value: formatTorqueTrainingValue(target.lowerLimit, target.unit) },
    { key: 'nominalTorque', label: '目標', value: formatTorqueTrainingValue(target.nominalTorque, target.unit) },
    { key: 'upperLimit', label: '上限', value: formatTorqueTrainingValue(target.upperLimit, target.unit) }
  ] as const;
}
