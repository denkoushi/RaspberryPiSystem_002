export const IMAGE_CANVAS_ZOOM_MIN = 0.5;
export const IMAGE_CANVAS_ZOOM_MAX = 2.5;
export const IMAGE_CANVAS_ZOOM_STEP = 0.25;
export const IMAGE_CANVAS_ZOOM_DEFAULT = 1;
export const IMAGE_CANVAS_TAP_MOVE_THRESHOLD_PX = 10;

export type ImageCanvasRect = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type ZoomedImageCanvasLayout = {
  image: ImageCanvasRect;
  contentWidth: number;
  contentHeight: number;
};

export function clampImageCanvasZoom(value: number): number {
  return Math.min(IMAGE_CANVAS_ZOOM_MAX, Math.max(IMAGE_CANVAS_ZOOM_MIN, value));
}

export function stepImageCanvasZoom(current: number, delta: number): number {
  return clampImageCanvasZoom(
    Math.round((current + delta) / IMAGE_CANVAS_ZOOM_STEP) * IMAGE_CANVAS_ZOOM_STEP
  );
}

export function computeImageContainLayout(
  containerWidth: number,
  containerHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number
): ImageCanvasRect | null {
  if (containerWidth <= 0 || containerHeight <= 0 || imageNaturalWidth <= 0 || imageNaturalHeight <= 0) {
    return null;
  }
  const scale = Math.min(containerWidth / imageNaturalWidth, containerHeight / imageNaturalHeight);
  const width = imageNaturalWidth * scale;
  const height = imageNaturalHeight * scale;
  return {
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
    width,
    height
  };
}

export function clientToContainedImageRatios(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  layout: ImageCanvasRect
): { xRatio: number; yRatio: number } | null {
  const localX = clientX - containerRect.left - layout.offsetX;
  const localY = clientY - containerRect.top - layout.offsetY;
  if (localX < 0 || localY < 0 || localX > layout.width || localY > layout.height) return null;
  return { xRatio: localX / layout.width, yRatio: localY / layout.height };
}

export function computeZoomedImageCanvasLayout(
  viewportWidth: number,
  viewportHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number,
  zoom: number
): ZoomedImageCanvasLayout | null {
  const base = computeImageContainLayout(viewportWidth, viewportHeight, imageNaturalWidth, imageNaturalHeight);
  if (!base || zoom <= 0) return null;
  const width = base.width * zoom;
  const height = base.height * zoom;
  const contentWidth = Math.max(viewportWidth, width);
  const contentHeight = Math.max(viewportHeight, height);
  return {
    image: {
      width,
      height,
      offsetX: (contentWidth - width) / 2,
      offsetY: (contentHeight - height) / 2
    },
    contentWidth,
    contentHeight
  };
}

export function pointerClientToZoomedImageRatios(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  scrollLeft: number,
  scrollTop: number,
  layout: ZoomedImageCanvasLayout
): { xRatio: number; yRatio: number } | null {
  const contentX = clientX - viewportRect.left + scrollLeft;
  const contentY = clientY - viewportRect.top + scrollTop;
  const localX = contentX - layout.image.offsetX;
  const localY = contentY - layout.image.offsetY;
  if (localX < 0 || localY < 0 || localX > layout.image.width || localY > layout.image.height) return null;
  return { xRatio: localX / layout.image.width, yRatio: localY / layout.image.height };
}

function near(a: number, b: number, epsilonPx: number): boolean {
  return Math.abs(a - b) <= epsilonPx;
}

export function areZoomedImageCanvasLayoutsEqual(
  a: ZoomedImageCanvasLayout | null,
  b: ZoomedImageCanvasLayout | null,
  epsilonPx = 0.5
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    near(a.contentWidth, b.contentWidth, epsilonPx) &&
    near(a.contentHeight, b.contentHeight, epsilonPx) &&
    near(a.image.width, b.image.width, epsilonPx) &&
    near(a.image.height, b.image.height, epsilonPx) &&
    near(a.image.offsetX, b.image.offsetX, epsilonPx) &&
    near(a.image.offsetY, b.image.offsetY, epsilonPx)
  );
}

export function shouldConfirmImageCanvasTap(maxMovementPx: number): boolean {
  return maxMovementPx < IMAGE_CANVAS_TAP_MOVE_THRESHOLD_PX;
}
