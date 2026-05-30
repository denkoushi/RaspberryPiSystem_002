export type ObjectContainRect = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export function computeObjectContainLayout(
  containerWidth: number,
  containerHeight: number,
  imageNaturalWidth: number,
  imageNaturalHeight: number
): ObjectContainRect | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageNaturalWidth <= 0 ||
    imageNaturalHeight <= 0
  ) {
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

export function clientToImageRatios(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  layout: ObjectContainRect
): { xRatio: number; yRatio: number } | null {
  const localX = clientX - containerRect.left - layout.offsetX;
  const localY = clientY - containerRect.top - layout.offsetY;
  if (localX < 0 || localY < 0 || localX > layout.width || localY > layout.height) {
    return null;
  }
  return {
    xRatio: localX / layout.width,
    yRatio: localY / layout.height
  };
}
