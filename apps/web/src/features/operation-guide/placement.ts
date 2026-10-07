export type GuideRect = { left: number; top: number; width: number; height: number };
export function overlaps(a: GuideRect, b: GuideRect, gap = 0): boolean {
  return a.left < b.left + b.width + gap && a.left + a.width > b.left - gap
    && a.top < b.top + b.height + gap && a.top + a.height > b.top - gap;
}

/** Prefer the lower right, then the other corners and the space beside the target. */
export function placeGuideCard(viewport: { width: number; height: number }, size: { width: number; height: number }, target: GuideRect | null, icon: GuideRect | null): GuideRect {
  const margin = 24;
  const right = Math.max(margin, viewport.width - size.width - margin);
  const bottom = Math.max(margin, viewport.height - size.height - 96);
  const candidates = [
    { left: right, top: bottom }, { left: margin, top: bottom },
    { left: right, top: margin }, { left: margin, top: margin },
    ...(target ? [
      { left: target.left - size.width - 28, top: target.top },
      { left: target.left + target.width + 28, top: target.top },
      { left: target.left, top: target.top - size.height - 28 },
      { left: target.left, top: target.top + target.height + 28 },
    ] : []),
  ].map(point => ({
    left: Math.max(8, Math.min(point.left, viewport.width - size.width - 8)),
    top: Math.max(8, Math.min(point.top, viewport.height - size.height - 8)),
    ...size,
  }));
  return candidates.find(rect => (!target || !overlaps(rect, target, 24)) && (!icon || !overlaps(rect, icon, 12)))
    // Very small viewports / targets covering the screen may have no free rectangle.
    ?? candidates.find(rect => !icon || !overlaps(rect, icon, 12)) ?? candidates[0];
}
