import {
  parseInspectionDrawingReturnFromLocation,
  type InspectionDrawingLocationReturn
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingReturnNavigation';

/** 開発プレビュー — 検査図面一覧 */
export const KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH = '/dev/kiosk-inspection-drawing-library';

export const KIOSK_INSPECTION_DRAWING_DEV_RETURN_PATHS = [KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH] as const;

export const INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE: InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: KIOSK_INSPECTION_DRAWING_DEV_LIBRARY_PATH,
  inspectionDrawingReturnLabel: '一覧へ戻る'
};

export function parseDevInspectionDrawingReturnFromLocation(
  state: unknown
): InspectionDrawingLocationReturn {
  return parseInspectionDrawingReturnFromLocation(state, {
    fallback: INSPECTION_DRAWING_DEV_RETURN_TO_LIBRARY_STATE,
    allowedReturnPaths: KIOSK_INSPECTION_DRAWING_DEV_RETURN_PATHS
  });
}
