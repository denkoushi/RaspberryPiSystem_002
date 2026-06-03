/**
 * 検査図面測定点名称の固定候補。
 * 将来は管理コンソール API から取得する adapter に差し替え可能。
 */
export const INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS: readonly string[] = [
  '外径',
  '内径',
  '全長',
  '全幅',
  '幅',
  '高さ',
  '穴径',
  'ピッチ',
  '深さ',
  '面粗度',
  '振れ',
  '平行度',
  '直角度',
  '真直度',
  '平面度',
  '真円度',
  '円筒度',
  '傾斜度',
  '位置度',
  '同心度',
  '同軸度',
  '対称度',
  '円周振れ',
  '全振れ',
  '輪郭度',
  '形状',
  '姿勢',
  '位置',
  '輪郭'
] as const;

export type MeasurementLabelSelectOption = {
  value: string;
  label: string;
};

/** select 用。候補外の現在値は一時 option として先頭に追加 */
export function buildMeasurementLabelSelectOptions(currentValue: string): MeasurementLabelSelectOption[] {
  const trimmed = currentValue.trim();
  const base = INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS.map((label) => ({
    value: label,
    label
  }));
  if (!trimmed) {
    return [{ value: '', label: '選択してください' }, ...base];
  }
  if (INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS.includes(trimmed as (typeof INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS)[number])) {
    return base;
  }
  return [{ value: trimmed, label: `${trimmed}（既存）` }, ...base];
}
