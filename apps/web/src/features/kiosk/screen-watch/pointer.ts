export type PointerPosition = { x: number; y: number };

export function validPointer(value: unknown): value is PointerPosition {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<PointerPosition>;
  return typeof point.x === 'number' && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1
    && typeof point.y === 'number' && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1;
}

/** object-fit: contain, centered in the video element. Letterbox taps are ignored. */
export function normalizeVideoPointer(clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number }, videoWidth: number, videoHeight: number): PointerPosition | null {
  if (videoWidth <= 0 || videoHeight <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  const point = {
    x: (clientX - rect.left - (rect.width - width) / 2) / width,
    y: (clientY - rect.top - (rect.height - height) / 2) / height
  };
  return validPointer(point) ? point : null;
}
