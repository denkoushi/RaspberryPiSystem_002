import { describe, expect, it } from 'vitest';

import { computeAnchoredPanelLeftEdge } from '../anchoredDropdownViewportClamp';

describe('computeAnchoredPanelLeftEdge', () => {
  const V = 800;
  const p = 16;
  const W = 192;

  it('returns anchorRight - W when that lies inside [p, V-p-W]', () => {
    const R = 400;
    expect(computeAnchoredPanelLeftEdge({ anchorRight: R, panelWidth: W, viewportWidth: V, padding: p })).toBe(
      R - W
    );
  });

  it('clamps to padding when ideal left is too small', () => {
    const R = 50;
    expect(computeAnchoredPanelLeftEdge({ anchorRight: R, panelWidth: W, viewportWidth: V, padding: p })).toBe(p);
  });

  it('clamps to V-p-W when ideal left is too large', () => {
    const R = V - p + 10;
    expect(computeAnchoredPanelLeftEdge({ anchorRight: R, panelWidth: W, viewportWidth: V, padding: p })).toBe(
      V - p - W
    );
  });

  it('pins to padding when panel is wider than usable viewport', () => {
    const wide = V - 2 * p + 100;
    expect(
      computeAnchoredPanelLeftEdge({ anchorRight: 400, panelWidth: wide, viewportWidth: V, padding: p })
    ).toBe(p);
  });

  it('handles zero-width panel', () => {
    expect(computeAnchoredPanelLeftEdge({ anchorRight: 100, panelWidth: 0, viewportWidth: V, padding: p })).toBe(100);
  });
});
