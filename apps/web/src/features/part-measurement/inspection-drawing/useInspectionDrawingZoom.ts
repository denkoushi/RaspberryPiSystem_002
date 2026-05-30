import { useCallback, useState } from 'react';

import {
  INSPECTION_DRAWING_ZOOM_DEFAULT,
  INSPECTION_DRAWING_ZOOM_STEP,
  stepInspectionDrawingZoom
} from './inspectionDrawingZoom';

export function useInspectionDrawingZoom(initialZoom = INSPECTION_DRAWING_ZOOM_DEFAULT) {
  const [zoom, setZoom] = useState(initialZoom);
  const [fitGeneration, setFitGeneration] = useState(0);

  const zoomIn = useCallback(() => {
    setZoom((current) => stepInspectionDrawingZoom(current, INSPECTION_DRAWING_ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((current) => stepInspectionDrawingZoom(current, -INSPECTION_DRAWING_ZOOM_STEP));
  }, []);

  const fitToView = useCallback(() => {
    setZoom(INSPECTION_DRAWING_ZOOM_DEFAULT);
    setFitGeneration((n) => n + 1);
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(INSPECTION_DRAWING_ZOOM_DEFAULT);
    setFitGeneration(0);
  }, []);

  return {
    zoom,
    zoomIn,
    zoomOut,
    fitToView,
    resetZoom,
    /** 全面表示時にキャンバスへスクロールリセットを伝える世代カウンタ */
    fitGeneration
  };
}
