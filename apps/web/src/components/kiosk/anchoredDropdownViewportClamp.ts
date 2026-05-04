/**
 * Pure geometry for fixed `AnchoredDropdownPortal` positioning.
 * Panels align their right edge to the anchor's right when possible,
 * then clamp so the panel stays within the viewport horizontally.
 */
export type ComputeAnchoredPanelLeftEdgeParams = {
  /** Anchor element's `getBoundingClientRect().right` */
  anchorRight: number;
  /** Panel `getBoundingClientRect().width` (must be >= 0) */
  panelWidth: number;
  /** Usually `window.innerWidth` */
  viewportWidth: number;
  /** Minimum gap from viewport left and right (e.g. 8–16) */
  padding: number;
};

/**
 * Returns CSS `left` (px) for a `position: fixed` panel when using **left edge**
 * placement with **no** `translateX`, such that:
 * - Preferably the panel's right edge matches `anchorRight`.
 * - The panel stays within `[padding, viewportWidth - padding]` horizontally.
 * - If the panel is wider than the usable width, pins to `padding`.
 */
export function computeAnchoredPanelLeftEdge(params: ComputeAnchoredPanelLeftEdgeParams): number {
  const { anchorRight, panelWidth, viewportWidth, padding } = params;
  const idealLeft = anchorRight - panelWidth;
  const lo = padding;
  const hi = viewportWidth - padding - panelWidth;
  if (hi < lo) {
    return lo;
  }
  return Math.min(Math.max(idealLeft, lo), hi);
}
