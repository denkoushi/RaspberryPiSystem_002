export type KioskSopRuntimeRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type KioskSopRuntimePoint = Readonly<{
  x: number;
  y: number;
}>;

export type KioskSopLeaderSegment = Readonly<{
  start: KioskSopRuntimePoint;
  end: KioskSopRuntimePoint;
}>;

/** Returns the actual image box produced by object-fit: contain, relative to its parent. */
export function computeContainedRect(
  parentWidth: number,
  parentHeight: number,
  contentWidth: number,
  contentHeight: number
): KioskSopRuntimeRect {
  if (parentWidth <= 0 || parentHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(parentWidth / contentWidth, parentHeight / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    left: (parentWidth - width) / 2,
    top: (parentHeight - height) / 2,
    width,
    height
  };
}

/** Joins the card's right-center to the matching circular/elliptical pin boundary. */
export function computeLeaderSegment(
  body: KioskSopRuntimeRect,
  card: KioskSopRuntimeRect,
  pin: KioskSopRuntimeRect
): KioskSopLeaderSegment {
  const start = {
    x: card.left + card.width - body.left,
    y: card.top + card.height / 2 - body.top
  };
  const center = {
    x: pin.left + pin.width / 2 - body.left,
    y: pin.top + pin.height / 2 - body.top
  };
  const radiusX = pin.width / 2;
  const radiusY = pin.height / 2;
  const deltaX = start.x - center.x;
  const deltaY = start.y - center.y;

  if (radiusX <= 0 || radiusY <= 0 || (deltaX === 0 && deltaY === 0)) {
    return { start, end: center };
  }

  const boundaryScale = 1 / Math.sqrt(
    (deltaX * deltaX) / (radiusX * radiusX) +
    (deltaY * deltaY) / (radiusY * radiusY)
  );
  return {
    start,
    end: {
      x: center.x + deltaX * boundaryScale,
      y: center.y + deltaY * boundaryScale
    }
  };
}
