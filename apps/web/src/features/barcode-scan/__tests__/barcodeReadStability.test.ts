import { describe, expect, it } from 'vitest';

import { reduceBarcodeStability } from '../barcodeReadStability';

const cfg = { requiredConsecutiveHits: 2, stableWindowMs: 600 } as const;

describe('reduceBarcodeStability', () => {
  it('空文字は状態を変えず確定しない', () => {
    const prev = { value: '123', consecutiveHits: 1, lastHitAtMs: 100 };
    const { next, shouldConfirm } = reduceBarcodeStability(prev, '   ', 200, cfg);
    expect(next).toBe(prev);
    expect(shouldConfirm).toBe(false);
  });

  it('1回目は確定しない', () => {
    const { next, shouldConfirm } = reduceBarcodeStability(null, 'ABC', 1000, cfg);
    expect(shouldConfirm).toBe(false);
    expect(next).toEqual({ value: 'ABC', consecutiveHits: 1, lastHitAtMs: 1000 });
  });

  it('同一値が時間窓内で2回なら確定', () => {
    const first = reduceBarcodeStability(null, 'XYZ', 1000, cfg);
    expect(first.shouldConfirm).toBe(false);
    const second = reduceBarcodeStability(first.next, 'XYZ', 1100, cfg);
    expect(second.shouldConfirm).toBe(true);
    expect(second.next).toEqual({ value: 'XYZ', consecutiveHits: 2, lastHitAtMs: 1100 });
  });

  it('時間窓を超えると連続が切れて1回目扱い', () => {
    const first = reduceBarcodeStability(null, 'A', 0, cfg);
    const second = reduceBarcodeStability(first.next, 'A', 1000, cfg);
    expect(second.next?.consecutiveHits).toBe(1);
    expect(second.shouldConfirm).toBe(false);
  });

  it('値が変われば連続がリセット', () => {
    const first = reduceBarcodeStability(null, 'A', 0, cfg);
    const second = reduceBarcodeStability(first.next, 'B', 100, cfg);
    expect(second.next).toEqual({ value: 'B', consecutiveHits: 1, lastHitAtMs: 100 });
    expect(second.shouldConfirm).toBe(false);
  });
});
