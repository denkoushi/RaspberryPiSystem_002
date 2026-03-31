import { describe, expect, it } from 'vitest';

import { buildKioskProgressOverviewSvg } from './kiosk-progress-overview-svg.js';

describe('buildKioskProgressOverviewSvg', () => {
  it('reserves chip column and clips chips so they do not extend past card inner edge', () => {
    const items = [
      {
        fseiban: 'S1',
        machineName: 'M',
        parts: [
          {
            fhincd: 'H1',
            productNo: 'P1',
            fhinmei: '部品名',
            dueDate: null,
            processes: [
              { rowId: 'a', resourceCd: '503', resourceNames: null, isCompleted: false },
              { rowId: 'b', resourceCd: '021', resourceNames: null, isCompleted: true },
              { rowId: 'c', resourceCd: '587', resourceNames: null, isCompleted: false },
            ],
          },
        ],
      },
    ];

    const svg = buildKioskProgressOverviewSvg(items, 1920, 1080);
    expect(svg).toContain('<defs>');
    expect(svg).toContain('clipPath');
    expect(svg).toContain('kpo-clip-s0-p0');

    // Card 0 inner right ≈ outerPad + cardW - cardPad; chip rects must stay left of that.
    const scale = 1;
    const outerPad = Math.round(12 * scale);
    const colGap = Math.round(8 * scale);
    const rowGap = Math.round(8 * scale);
    const cardW = (1920 - 2 * outerPad - 3 * colGap) / 4;
    const cardPad = Math.round(8 * scale);
    const innerRight = outerPad + cardW - cardPad;
    const innerH = 1080 - 2 * outerPad;
    const cardH = (innerH - rowGap) / 2;

    const rects = [...svg.matchAll(/<rect x="(\d+\.?\d*)" y="(\d+\.?\d*)" width="(\d+\.?\d*)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }))
      .filter((r) => r.w > 10 && r.w < 200);

    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(innerRight + 2);
    }
    const chipRectsRow0 = rects.filter((r) => r.x + r.w <= innerRight + 2 && r.y < outerPad + cardH - 4);
    expect(chipRectsRow0.length).toBeGreaterThan(0);
  });

  it('places the 5th card on the second row (chip rects below first row card height)', () => {
    const part = {
      fhincd: 'H1',
      productNo: 'P1',
      fhinmei: '部品',
      dueDate: null,
      processes: [{ rowId: 'a', resourceCd: '503', resourceNames: null, isCompleted: false }],
    };
    const items = [1, 2, 3, 4, 5].map((n) => ({
      fseiban: `S${n}`,
      machineName: 'M',
      parts: [part],
    }));

    const svg = buildKioskProgressOverviewSvg(items as Parameters<typeof buildKioskProgressOverviewSvg>[0], 1920, 1080);
    const scale = 1;
    const outerPad = 12;
    const colGap = 8;
    const rowGap = 8;
    const innerH = 1080 - 2 * outerPad;
    const cardH = (innerH - rowGap) / 2;
    const secondRowMinY = outerPad + cardH + 2;

    const rects = [...svg.matchAll(/<rect x="(\d+\.?\d*)" y="(\d+\.?\d*)" width="(\d+\.?\d*)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }))
      .filter((r) => r.w > 10 && r.w < 200);

    expect(rects.some((r) => r.y >= secondRowMinY)).toBe(true);
  });
});
