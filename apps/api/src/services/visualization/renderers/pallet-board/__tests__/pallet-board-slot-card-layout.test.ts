import { describe, expect, it } from 'vitest';
import { computePalletSlotCardLayout } from '../pallet-board-slot-card-layout.js';

describe('computePalletSlotCardLayout', () => {
  it('全幅行の x は bx+8、有効幅は innerW-16', () => {
    const bx = 100;
    const by = 50;
    const innerW = 200;
    const innerH = 120;
    const noSize = 14;
    const smallSize = 9;
    const { layout, maxFullWidth } = computePalletSlotCardLayout({ bx, by, innerW, innerH, noSize, smallSize });
    expect(layout.fullWidthX).toBe(bx + 8);
    expect(layout.fullWidthTextMaxWidthPx).toBe(innerW - 16);
    expect(maxFullWidth).toBeGreaterThan(0);
  });

  it('小さいスロットでも baseline が単調増加し、全幅行が上段より下', () => {
    const { layout } = computePalletSlotCardLayout({
      bx: 0,
      by: 0,
      innerW: 80,
      innerH: 60,
      noSize: 14,
      smallSize: 9,
    });
    const [y0, y1, y2, y3] = layout.fullWidthLineBaselines;
    expect(y0).toBeLessThan(y1);
    expect(y1).toBeLessThan(y2);
    expect(y2).toBeLessThan(y3);
    expect(y0).toBeGreaterThan(layout.rowContentTopY);
  });

  it('大きいスロットでも幾何が一貫（bodyX は thumb 右）', () => {
    const bx = 10;
    const { layout } = computePalletSlotCardLayout({
      bx,
      by: 5,
      innerW: 400,
      innerH: 300,
      noSize: 20,
      smallSize: 12,
    });
    expect(layout.bodyX).toBe(bx + layout.thumbW + 10);
    expect(layout.thumbW).toBe(Math.round(400 * 0.3));
  });
});
