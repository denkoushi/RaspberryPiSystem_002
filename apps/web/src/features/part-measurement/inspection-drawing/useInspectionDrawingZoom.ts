import { useImageCanvasZoom } from '../../kiosk/image-canvas';

import { INSPECTION_DRAWING_ZOOM_DEFAULT } from './inspectionDrawingZoom';

export function useInspectionDrawingZoom(initialZoom = INSPECTION_DRAWING_ZOOM_DEFAULT) {
  return useImageCanvasZoom(initialZoom);
}
