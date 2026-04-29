import { describe, expect, it } from 'vitest';

import { requiresSharedHistoryInsertBeforeEnableFilter } from '../leaderBoardSharedHistoryGate';

describe('leaderBoardSharedHistoryGate', () => {
  it('共有履歴に無い製番はサーバ登録が必要', () => {
    expect(requiresSharedHistoryInsertBeforeEnableFilter(['A', 'B'], 'C')).toBe(true);
  });

  it('共有履歴にある製番は追加PUT不要', () => {
    expect(requiresSharedHistoryInsertBeforeEnableFilter(['A', 'B'], 'B')).toBe(false);
  });

  it('空白は登録要求しない', () => {
    expect(requiresSharedHistoryInsertBeforeEnableFilter(['A'], '  ')).toBe(false);
  });

  it('入力はトリムされ共有履歴と一致すれば追加不要', () => {
    expect(requiresSharedHistoryInsertBeforeEnableFilter(['ABC'], ' ABC ')).toBe(false);
  });
});
