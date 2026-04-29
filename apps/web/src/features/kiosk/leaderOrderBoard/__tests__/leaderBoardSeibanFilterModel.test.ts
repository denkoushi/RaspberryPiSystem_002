import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import {
  ensureSeibanInFilters,
  isSeibanFilterSelected,
  toggleSeibanFilter
} from '../leaderBoardSeibanFilterModel';

describe('leaderBoardSeibanFilterModel', () => {
  it('toggleSeibanFilter: 空で追加、再トグルで削除', () => {
    let s = toggleSeibanFilter([], 'A001');
    expect(s).toEqual(['A001']);
    s = toggleSeibanFilter(s, 'A001');
    expect(s).toEqual([]);
  });

  it('toggleSeibanFilter: 複製は入れない（二重トグルは除去）', () => {
    const s = toggleSeibanFilter(['A', 'B'], 'B');
    expect(s).toEqual(['A']);
  });

  it('isSeibanFilterSelected', () => {
    expect(isSeibanFilterSelected(['X', 'Y'], 'X')).toBe(true);
    expect(isSeibanFilterSelected(['X'], 'Z')).toBe(false);
  });

  it('ensureSeibanInFilters: 末尾に追加（未存在時のみ）', () => {
    expect(ensureSeibanInFilters(['a'], 'b')).toEqual(['a', 'b']);
    expect(ensureSeibanInFilters(['a'], 'a')).toEqual(['a']);
  });

  it('空白だけの値は無視する', () => {
    expect(toggleSeibanFilter(['A'], '   ')).toEqual(['A']);
    expect(ensureSeibanInFilters(['A'], '   ')).toEqual(['A']);
  });

  it('上限件数を超えたら既存画面と同じく先頭から上限まで保持する', () => {
    const base = Array.from({ length: KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX }, (_, i) => `S${i}`);
    expect(toggleSeibanFilter(base, 'EXTRA')).toEqual(base);
    expect(ensureSeibanInFilters(base, 'EXTRA')).toEqual(base);
  });
});
