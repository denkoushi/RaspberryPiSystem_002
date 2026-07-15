import {
  computeZoomedImageCanvasLayout,
  pointerClientToZoomedImageRatios,
  type ZoomedImageCanvasLayout
} from '../../kiosk/image-canvas';

/** 検査図面の既存 import を維持する互換型。 */
export type ZoomedCanvasLayout = ZoomedImageCanvasLayout;

/** 検査図面の既存 import を維持する互換関数。 */
export const computeZoomedCanvasLayout = computeZoomedImageCanvasLayout;

/** 検査図面の既存 import を維持する互換関数。 */
export const pointerClientToImageRatios = pointerClientToZoomedImageRatios;

export type ScrollToCenterMarkerInput = {
  layout: ZoomedCanvasLayout;
  xRatio: number;
  yRatio: number;
  viewportWidth: number;
  viewportHeight: number;
};

/**
 * 測定点 ratio を viewport 中央付近へ寄せる scroll 位置（clamp 済み）。
 */
export function zoomedLayoutMatchesCanvasZoom(
  layout: ZoomedCanvasLayout,
  viewportWidth: number,
  viewportHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number,
  zoom: number,
  epsilonPx = 0.5
): boolean {
  const expected = computeZoomedCanvasLayout(
    viewportWidth,
    viewportHeight,
    imageNaturalWidth,
    imageNaturalHeight,
    zoom
  );
  if (!expected) return false;
  return (
    Math.abs(layout.contentWidth - expected.contentWidth) <= epsilonPx &&
    Math.abs(layout.contentHeight - expected.contentHeight) <= epsilonPx &&
    Math.abs(layout.image.width - expected.image.width) <= epsilonPx &&
    Math.abs(layout.image.height - expected.image.height) <= epsilonPx
  );
}

export function computeScrollToCenterMarker(input: ScrollToCenterMarkerInput): {
  scrollLeft: number;
  scrollTop: number;
} {
  const { layout, xRatio, yRatio, viewportWidth, viewportHeight } = input;
  const { image, contentWidth, contentHeight } = layout;
  const markerX = image.offsetX + xRatio * image.width;
  const markerY = image.offsetY + yRatio * image.height;
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  const scrollLeft = Math.min(maxScrollLeft, Math.max(0, markerX - viewportWidth / 2));
  const scrollTop = Math.min(maxScrollTop, Math.max(0, markerY - viewportHeight / 2));
  return { scrollLeft, scrollTop };
}
