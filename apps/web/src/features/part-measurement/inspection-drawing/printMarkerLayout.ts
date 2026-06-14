import { computeObjectContainLayout, type ObjectContainRect } from './computeObjectContainLayout';

import type { InspectionDrawingPoint } from './types';

export type PrintMarkerPosition = {
  leftPercent: number;
  topPercent: number;
};

export function computePrintMarkerPosition(
  point: Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'>,
  containerWidth: number,
  containerHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number
): PrintMarkerPosition | null {
  const layout = computeObjectContainLayout(
    containerWidth,
    containerHeight,
    imageNaturalWidth,
    imageNaturalHeight
  );
  if (!layout) return null;
  return markerPositionInObjectContainContainer(point, layout, containerWidth, containerHeight);
}

export function markerPositionInObjectContainContainer(
  point: Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'>,
  layout: ObjectContainRect,
  containerWidth: number,
  containerHeight: number
): PrintMarkerPosition {
  const left = layout.offsetX + point.xRatio * layout.width;
  const top = layout.offsetY + point.yRatio * layout.height;
  return {
    leftPercent: (left / containerWidth) * 100,
    topPercent: (top / containerHeight) * 100
  };
}
