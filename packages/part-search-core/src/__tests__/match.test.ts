import { describe, expect, it } from 'vitest';

import { matchesPartSearchFields } from '../match.js';

describe('matchesPartSearchFields', () => {
  it('requires AND across tokens', () => {
    const row = { fhinmei: 'テーブル脚金具', fhincd: 'X' };
    expect(matchesPartSearchFields(row, 'テーブル 脚')).toBe(true);
    expect(matchesPartSearchFields(row, 'テーブル ボルト')).toBe(false);
  });

  it('matches single-token alias expansion', () => {
    const row = { fhinmei: 'テーブル脚', fhincd: null };
    expect(matchesPartSearchFields(row, 'アシ')).toBe(true);
  });
});
