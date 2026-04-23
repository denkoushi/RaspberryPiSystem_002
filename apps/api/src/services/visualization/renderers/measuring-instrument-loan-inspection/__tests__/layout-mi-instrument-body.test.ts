import { describe, expect, it } from 'vitest';
import { ACTIVE_BODY_FONT_SCALE, RETURNED_BODY_FONT_SCALE } from '../mi-instrument-display.types.js';
import {
  buildBodyLinesForEntrySlice,
  computeLineHeightForFont,
  layoutBodyWithinMaxHeight,
} from '../layout-mi-instrument-body.js';

describe('layout-mi-instrument-body', () => {
  it('renders active instruments as management number line then name line', () => {
    const lines = buildBodyLinesForEntrySlice(
      [{ kind: 'active', managementNumber: 'MG-1', name: 'デジタルノギス' }],
      1,
      400,
      13,
      1,
      4,
    );
    expect(lines.length).toBe(2);
    expect(lines[0]!.text).toContain('MG-1');
    expect(lines[1]!.text).toContain('デジタルノギス');
    expect(lines[0]!.fontSize).toBe(Math.round(13 * ACTIVE_BODY_FONT_SCALE));
    expect(lines[1]!.fontSize).toBe(lines[0]!.fontSize);
  });

  it('uses larger line height for active font than base', () => {
    const base = 13;
    const activePx = Math.round(base * ACTIVE_BODY_FONT_SCALE);
    const hActive = computeLineHeightForFont(activePx, 1);
    const hBase = computeLineHeightForFont(base, 1);
    expect(hActive).toBeGreaterThan(hBase);
  });

  it('renders returned as one muted line at base body scale', () => {
    const lines = buildBodyLinesForEntrySlice(
      [{ kind: 'returned', managementNumber: 'R1', name: 'ノギス' }],
      1,
      400,
      13,
      1,
      4,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]!.tone).toBe('muted');
    expect(lines[0]!.fontSize).toBe(Math.round(13 * RETURNED_BODY_FONT_SCALE));
  });

  it('fits empty loan as dash with active scale', () => {
    const r = layoutBodyWithinMaxHeight({
      entries: [],
      maxWidthPx: 200,
      baseFontPx: 13,
      scale: 1,
      maxHeight: 500,
      namesStartY: 66,
      bottomPad: 12,
    });
    expect(r.bodyLines).toEqual([
      expect.objectContaining({ text: '-', tone: 'secondary' }),
    ]);
    expect(r.bodyLines[0]!.fontSize).toBe(Math.round(13 * ACTIVE_BODY_FONT_SCALE));
  });
});
