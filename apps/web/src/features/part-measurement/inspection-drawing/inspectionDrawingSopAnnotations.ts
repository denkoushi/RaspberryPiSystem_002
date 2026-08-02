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
  'reload-library',
  'edit-template',
  'open-report',
  'open-history',
  'retire-template',
  'template-metadata',
  'open-visual-source',
  'pick-existing-visual',
  'upload-new-visual',
  'self-inspection-setting',
  'save-revision',
  'select-point',
  'measurement-name',
  'nominal-value',
  'upper-tolerance',
  'lower-tolerance',
  'nudge-point',
  'depth-mode',
  'face-thread',
  'direct-label',
  'ocr-candidate',
  'add-point',
  'place-callout',
  'point-list',
  'delete-one-point',
  'delete-all-points',
  'test-input',
  'guided-trial',
  'zoom-drawing',
  'saved-report',
  'return-library',
  'group-save',
  'single-save',
  'add-group-resource',
  'activate-history',
  'save-scope-warning'
] as const;

export type InspectionDrawingSopTargetId = typeof INSPECTION_DRAWING_SOP_TARGET_IDS[number];
export type InspectionDrawingSopTargetProps = {
  'data-kiosk-sop-target': InspectionDrawingSopTargetId;
};

/** 機能コードと取説定義を同じ安定IDで結ぶ。表示やイベントは変更しない。 */
export function inspectionDrawingSopTargetProps(
  targetId: InspectionDrawingSopTargetId
): InspectionDrawingSopTargetProps {
  return { 'data-kiosk-sop-target': targetId };
}
