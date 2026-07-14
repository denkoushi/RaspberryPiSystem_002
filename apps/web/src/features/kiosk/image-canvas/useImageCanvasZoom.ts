import { useCallback, useState } from 'react';

import {
  clampImageCanvasZoom,
  IMAGE_CANVAS_ZOOM_DEFAULT,
  IMAGE_CANVAS_ZOOM_STEP,
  stepImageCanvasZoom
} from './imageCanvasModel';

export function useImageCanvasZoom(initialZoom = IMAGE_CANVAS_ZOOM_DEFAULT) {
  const [zoom, setZoom] = useState(initialZoom);
  const [fitGeneration, setFitGeneration] = useState(0);
  const zoomIn = useCallback(() => setZoom((value) => stepImageCanvasZoom(value, IMAGE_CANVAS_ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((value) => stepImageCanvasZoom(value, -IMAGE_CANVAS_ZOOM_STEP)), []);
  const fitToView = useCallback(() => {
    setZoom(IMAGE_CANVAS_ZOOM_DEFAULT);
    setFitGeneration((value) => value + 1);
  }, []);
  const resetZoom = useCallback(() => {
    setZoom(IMAGE_CANVAS_ZOOM_DEFAULT);
    setFitGeneration(0);
  }, []);
  const setZoomLevel = useCallback((value: number) => setZoom(clampImageCanvasZoom(value)), []);
  return { zoom, zoomIn, zoomOut, fitToView, resetZoom, setZoomLevel, fitGeneration };
}
