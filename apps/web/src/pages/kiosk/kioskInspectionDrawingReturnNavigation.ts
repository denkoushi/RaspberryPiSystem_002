import {
  parseInspectionDrawingReturnFromLocation,
  type InspectionDrawingLocationReturn
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingReturnNavigation';
import { KIOSK_INSPECTION_DRAWING_LIBRARY_PATH } from '../../features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes';

/** 本番キオスク — 検査図面作成/改版で許可する戻り先 pathname */
export const KIOSK_INSPECTION_DRAWING_PRODUCTION_RETURN_PATHS = [
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH
] as const;

export const INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE: InspectionDrawingLocationReturn = {
  inspectionDrawingReturnTo: KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  inspectionDrawingReturnLabel: '一覧へ戻る'
};

export function parseKioskInspectionDrawingReturnFromLocation(
  state: unknown
): InspectionDrawingLocationReturn {
  return parseInspectionDrawingReturnFromLocation(state, {
    fallback: INSPECTION_DRAWING_RETURN_TO_LIBRARY_STATE,
    allowedReturnPaths: KIOSK_INSPECTION_DRAWING_PRODUCTION_RETURN_PATHS
  });
}
