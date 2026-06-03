import {
  parseInspectionDrawingReturnFromLocation,
  type InspectionDrawingLocationReturn
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingReturnNavigation';

/** 開発プレビュー — 検査図面一覧 */
export const KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH = '/dev/kiosk-inspection-drawing-library';

export const KIOSK_INSPECTION_DRAWING_DEV_RETURN_PRESETS = [
  { pathname: KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH, label: '一覧へ戻る' }
] as const;

export const INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE: InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH,
  inspectionDrawingReturnLabel: KIOSK_INSPECTION_DRAWING_DEV_RETURN_PRESETS[0].label
};

export function parseDevInspectionDrawingReturnFromLocation(
  state: unknown
): InspectionDrawingLocationReturn {
  return parseInspectionDrawingReturnFromLocation(state, {
    fallback: INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE,
    returnPresets: KIOSK_INSPECTION_DRAWING_DEV_RETURN_PRESETS
  });
}
