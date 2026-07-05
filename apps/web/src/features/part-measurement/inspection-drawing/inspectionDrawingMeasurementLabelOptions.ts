import {
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS,
  normalizeInspectionDrawingMeasurementLabel,
  type InspectionDrawingMeasurementLabelSetting
} from '@raspi-system/shared-types';

/** 検査図面測定点名称の既定候補。 */
export const INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS = DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS;

export type MeasurementLabelSelectOption = {
  value: string;
  label: string;
};

/** select 用。候補外の現在値は一時 option として先頭に追加 */
export function buildMeasurementLabelSelectOptions(
  currentValue: string,
  settings: readonly InspectionDrawingMeasurementLabelSetting[] = buildDefaultInspectionDrawingMeasurementLabelSettings()
): MeasurementLabelSelectOption[] {
  const trimmed = currentValue.trim();
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const setting of settings) {
    const label = normalizeInspectionDrawingMeasurementLabel(setting.label);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  const base = labels.map((label) => ({ value: label, label }));
  if (!trimmed) {
    return [{ value: '', label: '選択してください' }, ...base];
  }
  if (seen.has(trimmed)) {
    return base;
  }
  return [{ value: trimmed, label: `${trimmed}（既存）` }, ...base];
}
