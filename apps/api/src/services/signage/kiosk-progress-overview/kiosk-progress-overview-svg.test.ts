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
    expect(svg).toContain('kpo-clip-c0-r0');

    // Card 0 inner right ≈ outerPad + cardW - cardPad; chip rects must stay left of that.
    const scale = 1;
    const outerPad = Math.round(12 * scale);
    const colGap = Math.round(8 * scale);
    const cardW = (1920 - 2 * outerPad - 4 * colGap) / 5;
    const cardPad = Math.round(8 * scale);
    const innerRight = outerPad + cardW - cardPad;

    const rects = [...svg.matchAll(/<rect x="(\d+\.?\d*)" y="(\d+\.?\d*)" width="(\d+\.?\d*)"/g)]
      .map((m) => ({ x: Number(m[1]), w: Number(m[3]) }))
      .filter((r) => r.w > 10 && r.w < 200);

    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(innerRight + 2);
    }
  });
});
