/**
 * Fit an image into a parent box while preserving aspect ratio (object-contain math).
 */
export function computeContainSize(
  parentWidth: number,
  parentHeight: number,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  if (parentWidth <= 0 || parentHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(parentWidth / naturalWidth, parentHeight / naturalHeight);
  return {
    width: Math.max(1, Math.floor(naturalWidth * scale)),
    height: Math.max(1, Math.floor(naturalHeight * scale))
  };
}
