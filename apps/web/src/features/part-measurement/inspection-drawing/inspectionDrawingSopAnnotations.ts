const INSPECTION_DRAWING_SOP_TARGET_IDS = [
  'inspection-navigation',
  'drawing-digit-search',
  'visual-name-search',
  'register-visual',
  'rename-visual',
  'create-from-visual',
  'part-number-filter',
  'resource-filter',
  'include-inactive',
  'reload-library'
] as const;

export type InspectionDrawingSopTargetId = typeof INSPECTION_DRAWING_SOP_TARGET_IDS[number];

/** 機能コードと取説定義を同じ安定IDで結ぶ。表示やイベントは変更しない。 */
export function inspectionDrawingSopTargetProps(targetId: InspectionDrawingSopTargetId) {
  return { 'data-kiosk-sop-target': targetId } as const;
}
