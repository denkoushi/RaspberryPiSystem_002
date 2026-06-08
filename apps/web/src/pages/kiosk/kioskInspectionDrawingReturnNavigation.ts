import {
  parseInspectionDrawingReturnFromLocation,
  type InspectionDrawingLocationReturn
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingReturnNavigation';
import {
  INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH
} from '../../features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';

/** 本番キオスク — 検査図面作成/改版で許可する戻り先（pathname → 表示ラベル） */
export const KIOSK_INSPECTION_DRAWING_PRODUCTION_RETURN_PRESETS = [
  { pathname: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH, label: '一覧へ戻る' }
] as const;

export { INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE };

export function parseKioskInspectionDrawingReturnFromLocation(
  state: unknown
): InspectionDrawingLocationReturn {
  return parseInspectionDrawingReturnFromLocation(state, {
    fallback: INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE,
    returnPresets: KIOSK_INSPECTION_DRAWING_PRODUCTION_RETURN_PRESETS
  });
}
