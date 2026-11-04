import { describe, expect, it } from 'vitest';

import { aggregateResourceCdProcessChips } from '../aggregateResourceCdProcessChips';

const rowId = (cd: string) => `chip-${cd}`;

describe('aggregateResourceCdProcessChips', () => {
  it('空入力・空白の資源CDは無視する', () => {
    expect(aggregateResourceCdProcessChips([], rowId)).toEqual([]);
    expect(
      aggregateResourceCdProcessChips([{ resourceCd: '   ', isCompleted: true, resourceNames: ['X'] }], rowId)
    ).toEqual([]);
  });

  it('同じ資源CD（trim 後）は1チップにまとめ、全工程完了のときだけ完了にする', () => {
    const result = aggregateResourceCdProcessChips(
      [
        { resourceCd: '305', isCompleted: true },
        { resourceCd: ' 305 ', isCompleted: false },
        { resourceCd: '581', isCompleted: true },
        { resourceCd: '581', isCompleted: true },
      ],
      rowId
    );
    expect(result).toEqual([
      { rowId: 'chip-305', resourceCd: '305', isCompleted: false },
      { rowId: 'chip-581', resourceCd: '581', isCompleted: true },
    ]);
  });

  it('未完了が先に来ても後から完了が来て完了にはならない', () => {
    const [chip] = aggregateResourceCdProcessChips(
      [
        { resourceCd: 'A', isCompleted: false },
        { resourceCd: 'A', isCompleted: true },
      ],
      rowId
    );
    expect(chip.isCompleted).toBe(false);
  });

  it('資源名は出現順を保ち、trim・空文字除去・重複除去してマージする', () => {
    const [chip] = aggregateResourceCdProcessChips(
      [
        { resourceCd: 'A', isCompleted: true, resourceNames: [' 研削1 ', '', '研削1', '研削2'] },
        { resourceCd: 'A', isCompleted: true, resourceNames: ['研削2', ' 研削3', '  '] },
      ],
      rowId
    );
    expect(chip.resourceNames).toEqual(['研削1', '研削2', '研削3']);
  });

  it('資源名が1つも無いチップには resourceNames キーを付けない', () => {
    const [chip] = aggregateResourceCdProcessChips(
      [{ resourceCd: 'A', isCompleted: false, resourceNames: ['', ' '] }],
      rowId
    );
    expect(chip).not.toHaveProperty('resourceNames');
  });

  it('資源CDを ja ロケールで並べ、rowId は CD ごとに生成する', () => {
    const result = aggregateResourceCdProcessChips(
      [
        { resourceCd: 'B', isCompleted: false },
        { resourceCd: 'A', isCompleted: false },
        { resourceCd: 'C', isCompleted: false },
      ],
      rowId
    );
    expect(result.map((c) => c.rowId)).toEqual(['chip-A', 'chip-B', 'chip-C']);
  });
});
