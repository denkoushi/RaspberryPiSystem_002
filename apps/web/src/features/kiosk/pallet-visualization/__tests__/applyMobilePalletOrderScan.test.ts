import { describe, expect, it, vi } from 'vitest';

import { applyMobilePalletOrderScan } from '../applyMobilePalletOrderScan';

describe('applyMobilePalletOrderScan', () => {
  it('加工機未選択（palletCount 無効）', () => {
    const setPalletNo = vi.fn();
    const addBarcodeToPallet = vi.fn();
    const r = applyMobilePalletOrderScan('ABC', [3], {
      palletCount: null,
      setPalletNo,
      addBarcodeToPallet,
    });
    expect(r).toEqual({ ok: false, message: '加工機を選択してください' });
    expect(setPalletNo).not.toHaveBeenCalled();
    expect(addBarcodeToPallet).not.toHaveBeenCalled();
  });

  it('桁が不正', () => {
    const setPalletNo = vi.fn();
    const addBarcodeToPallet = vi.fn();
    const r = applyMobilePalletOrderScan('ABC', [], {
      palletCount: 10,
      setPalletNo,
      addBarcodeToPallet,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBeTruthy();
    expect(setPalletNo).not.toHaveBeenCalled();
  });

  it('成功時は setPalletNo と addBarcodeToPallet の順で呼ぶ', () => {
    const order: string[] = [];
    const setPalletNo = vi.fn((n: number) => {
      order.push(`set:${n}`);
    });
    const addBarcodeToPallet = vi.fn((raw: string, no: number) => {
      order.push(`add:${raw}:${no}`);
    });
    const r = applyMobilePalletOrderScan('  XYZ  ', [3], {
      palletCount: 10,
      setPalletNo,
      addBarcodeToPallet,
    });
    expect(r).toEqual({ ok: true });
    expect(order).toEqual(['set:3', 'add:XYZ:3']);
  });
});
