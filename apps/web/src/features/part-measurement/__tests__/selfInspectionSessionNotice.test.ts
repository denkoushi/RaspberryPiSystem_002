import { describe, expect, it } from 'vitest';

import { resolveSelfInspectionSessionNotice } from '../selfInspectionSessionNotice';

describe('resolveSelfInspectionSessionNotice', () => {
  const allInputs = {
    actionError: '操作エラー',
    nfcMessage: 'NFCエラー',
    guideHint: 'ガイド通知',
    saveReason: '保存不可',
    completeHint: '完了案内'
  };

  it.each([
    [{}, '操作エラー', 'amber'],
    [{ actionError: null }, 'NFCエラー', 'amber'],
    [{ actionError: null, nfcMessage: null }, 'ガイド通知', 'cyan'],
    [{ actionError: null, nfcMessage: null, guideHint: null }, '保存不可', 'neutral'],
    [{ actionError: null, nfcMessage: null, guideHint: null, saveReason: null }, '完了案内', 'cyan']
  ] as const)('uses the fixed priority for %o', (overrides, message, tone) => {
    expect(resolveSelfInspectionSessionNotice({ ...allInputs, ...overrides })).toEqual({ message, tone });
  });

  it('uses red only for the out-of-tolerance save reason', () => {
    expect(resolveSelfInspectionSessionNotice({ saveReason: '公差外未確認', saveReasonIsOutOfTolerance: true }))
      .toEqual({ message: '公差外未確認', tone: 'red' });
  });

  it('returns null when no notice exists', () => {
    expect(resolveSelfInspectionSessionNotice({})).toBeNull();
  });
});
