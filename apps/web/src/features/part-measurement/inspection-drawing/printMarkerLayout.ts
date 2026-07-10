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

export type PrintCalloutLine = {
  x1Percent: number;
  y1Percent: number;
  x2Percent: number;
  y2Percent: number;
  tipLeftPercent: number;
  tipTopPercent: number;
  markerNo: number;
};

/** 印刷用: tip がある点の引出線座標（コンテナ %） */
export function computePrintCalloutLines(
  points: InspectionDrawingPoint[],
  containerWidth: number,
  containerHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number
): PrintCalloutLine[] {
  const layout = computeObjectContainLayout(
    containerWidth,
    containerHeight,
    imageNaturalWidth,
    imageNaturalHeight
  );
  if (!layout) return [];
  const lines: PrintCalloutLine[] = [];
  for (const point of points) {
    const tipX = point.calloutTipXRatio;
    const tipY = point.calloutTipYRatio;
    if (
      typeof tipX !== 'number' ||
      typeof tipY !== 'number' ||
      !Number.isFinite(tipX) ||
      !Number.isFinite(tipY)
    ) {
      continue;
    }
    const markerLeft = layout.offsetX + point.xRatio * layout.width;
    const markerTop = layout.offsetY + point.yRatio * layout.height;
    const tipLeft = layout.offsetX + tipX * layout.width;
    const tipTop = layout.offsetY + tipY * layout.height;
    lines.push({
      x1Percent: (markerLeft / containerWidth) * 100,
      y1Percent: (markerTop / containerHeight) * 100,
      x2Percent: (tipLeft / containerWidth) * 100,
      y2Percent: (tipTop / containerHeight) * 100,
      tipLeftPercent: (tipLeft / containerWidth) * 100,
      tipTopPercent: (tipTop / containerHeight) * 100,
      markerNo: point.markerNo
    });
  }
  return lines;
}
