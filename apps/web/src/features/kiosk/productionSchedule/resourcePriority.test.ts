import { describe, expect, it } from 'vitest';

import { prioritizeResourceCdsByPresence } from './resourcePriority';

describe('prioritizeResourceCdsByPresence', () => {
  it('登録製番未選択時は入力順をそのまま返す', () => {
    const visible = ['305', '581', '582', '1', '2'];
    const inRows = ['581', '1'];
    expect(prioritizeResourceCdsByPresence(visible, inRows, false)).toEqual(visible);
  });

  it('登録製番アクティブ時、検索結果に含まれる資源CDを左に寄せる', () => {
    const visible = ['305', '581', '582', '1', '2'];
    const inRows = ['581', '1'];
    expect(prioritizeResourceCdsByPresence(visible, inRows, true)).toEqual([
      '581',
      '1',
      '305',
      '582',
      '2'
    ]);
  });

  it('検索結果に含まれる資源CDが無い場合は入力順を維持', () => {
    const visible = ['305', '581', '582'];
    const inRows = ['999', '888'];
    expect(prioritizeResourceCdsByPresence(visible, inRows, true)).toEqual(visible);
  });

  it('resourceCdsInRowsが空の場合は入力順を維持', () => {
    const visible = ['305', '581', '582'];
    const inRows: string[] = [];
    expect(prioritizeResourceCdsByPresence(visible, inRows, true)).toEqual(visible);
  });

  it('複数製番相当で複数資源CDがヒットした場合、visibleの順序で優先グループを左寄せ', () => {
    const visible = ['1', '2', '305', '581', '582', '583'];
    const inRows = ['582', '305', '1'];
    expect(prioritizeResourceCdsByPresence(visible, inRows, true)).toEqual([
      '1',
      '305',
      '582',
      '2',
      '581',
      '583'
    ]);
  });
});
