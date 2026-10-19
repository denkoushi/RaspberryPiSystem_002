export type InspectionDrawingToleranceKind = 'dimension' | 'geometric';

export type InspectionDrawingMeasurementLabelSetting = {
  label: string;
  toleranceKind: InspectionDrawingToleranceKind;
};

export const INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION: InspectionDrawingToleranceKind = 'dimension';
export const INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC: InspectionDrawingToleranceKind = 'geometric';

export const DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS: readonly string[] = [
  '外径',
  '内径',
  '全長',
  '全幅',
  '幅',
  '厚み',
  '高さ',
  '穴径',
  'ピッチ',
  'キリ穴ピッチ',
  'ザグリ穴ピッチ',
  'ネジ穴ピッチ',
  '穴ピッチ',
  '深さ',
  'ネジ穴深さ',
  'キリ穴深さ',
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

export function normalizeInspectionDrawingMeasurementLabel(label: string): string {
  return label.trim();
}

export function resolveDefaultInspectionDrawingToleranceKind(label: string): InspectionDrawingToleranceKind {
  return normalizeInspectionDrawingMeasurementLabel(label).includes('度')
    ? INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC
    : INSPECTION_DRAWING_TOLERANCE_KIND_DIMENSION;
}

export function buildDefaultInspectionDrawingMeasurementLabelSettings(
  labels: readonly string[] = DEFAULT_INSPECTION_DRAWING_MEASUREMENT_LABELS
): InspectionDrawingMeasurementLabelSetting[] {
  const seen = new Set<string>();
  const settings: InspectionDrawingMeasurementLabelSetting[] = [];
  for (const rawLabel of labels) {
    const label = normalizeInspectionDrawingMeasurementLabel(rawLabel);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    settings.push({
      label,
      toleranceKind: resolveDefaultInspectionDrawingToleranceKind(label)
    });
  }
  return settings;
}

export function mergeInspectionDrawingMeasurementLabelSettings(
  defaults: readonly InspectionDrawingMeasurementLabelSetting[],
  overrides: readonly InspectionDrawingMeasurementLabelSetting[]
): InspectionDrawingMeasurementLabelSetting[] {
  const overridesByLabel = new Map<string, InspectionDrawingToleranceKind>();
  const defaultLabels = new Set<string>();
  const merged: InspectionDrawingMeasurementLabelSetting[] = [];
  for (const setting of defaults) {
    const label = normalizeInspectionDrawingMeasurementLabel(setting.label);
    if (!label) continue;
    defaultLabels.add(label);
  }
  for (const setting of overrides) {
    const label = normalizeInspectionDrawingMeasurementLabel(setting.label);
    if (!label) continue;
    overridesByLabel.set(label, setting.toleranceKind);
  }
  for (const setting of defaults) {
    const label = normalizeInspectionDrawingMeasurementLabel(setting.label);
    if (!label) continue;
    merged.push({
      label,
      toleranceKind: overridesByLabel.get(label) ?? setting.toleranceKind
    });
  }
  const custom = [...overridesByLabel.entries()]
    .filter(([label]) => !defaultLabels.has(label))
    .map(([label, toleranceKind]) => ({ label, toleranceKind }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  return [...merged, ...custom];
}

export function resolveInspectionDrawingToleranceKindForLabel(
  label: string,
  settings: readonly InspectionDrawingMeasurementLabelSetting[] = []
): InspectionDrawingToleranceKind {
  const normalized = normalizeInspectionDrawingMeasurementLabel(label);
  const match = settings.find((setting) => normalizeInspectionDrawingMeasurementLabel(setting.label) === normalized);
  return match?.toleranceKind ?? resolveDefaultInspectionDrawingToleranceKind(normalized);
}

export function buildInspectionDrawingToleranceCandidateValues(
  kind: InspectionDrawingToleranceKind
): string[] {
  if (kind === INSPECTION_DRAWING_TOLERANCE_KIND_GEOMETRIC) {
    return [
      '0',
      ...Array.from({ length: 9 }, (_, index) => `0.00${index + 1}`),
      '0.01',
      '0.015',
      '0.020',
      '0.030',
      '0.050'
    ];
  }

  const values: string[] = [];
  for (let scaled = -9; scaled <= 9; scaled += 1) {
    if (scaled === 0) {
      values.push('0');
    } else if (scaled > 0) {
      values.push(`+${(scaled / 10).toFixed(1)}`);
    } else {
      values.push((scaled / 10).toFixed(1));
    }
  }
  return values;
}

const DEPTH_TOLERANCE_CANDIDATE_LABELS = new Set(['深さ', 'ネジ穴深さ', 'キリ穴深さ']);

function buildDepthToleranceCandidateValues(): string[] {
  return Array.from({ length: 21 }, (_, index) => String(index));
}

export function buildInspectionDrawingToleranceCandidateValuesForLabel(
  label: string,
  settings: readonly InspectionDrawingMeasurementLabelSetting[] = []
): string[] {
  const normalized = normalizeInspectionDrawingMeasurementLabel(label);
  if (DEPTH_TOLERANCE_CANDIDATE_LABELS.has(normalized)) {
    return buildDepthToleranceCandidateValues();
  }
  return buildInspectionDrawingToleranceCandidateValues(
    resolveInspectionDrawingToleranceKindForLabel(label, settings)
  );
}

export function resolveInspectionDrawingGeneralToleranceForNominal(nominal: number): string | null {
  if (!Number.isFinite(nominal)) {
    return null;
  }
  if (nominal >= 0.5 && nominal <= 6) {
    return '0.1';
  }
  if (nominal > 6 && nominal <= 30) {
    return '0.2';
  }
  if (nominal > 30 && nominal <= 120) {
    return '0.3';
  }
  if (nominal > 120 && nominal <= 400) {
    return '0.5';
  }
  if (nominal > 400 && nominal <= 1000) {
    return '0.8';
  }
  if (nominal > 1000 && nominal <= 2000) {
    return '1.2';
  }
  if (nominal > 2000 && nominal <= 4000) {
    return '2.0';
  }
  return null;
}
