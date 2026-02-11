export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function insetRect(rect: Rect, insetX: number, insetY = insetX): Rect {
  const nextWidth = Math.max(0, rect.width - insetX * 2);
  const nextHeight = Math.max(0, rect.height - insetY * 2);
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: nextWidth,
    height: nextHeight,
  };
}
