import { describe, expect, it } from 'vitest';

import {
  appendLeaderBoardSeibanPrefixChar,
  clearLeaderBoardSeibanPrefix,
  formatLeaderBoardSeibanPrefixDisplayPadded,
  LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN,
  trimLastLeaderBoardSeibanPrefixChar
} from '../leaderBoardSeibanPrefixFilterActions';

describe('leaderBoardSeibanPrefixFilterActions', () => {
  it('appendLeaderBoardSeibanPrefixChar は最大桁を超えない', () => {
    const base = '123456789';
    expect(appendLeaderBoardSeibanPrefixChar(base, 'X')).toBe(base);
    expect(base.length).toBe(LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN);
  });

  it('trimLastLeaderBoardSeibanPrefixChar は末尾1コードユニット削除', () => {
    expect(trimLastLeaderBoardSeibanPrefixChar('')).toBe('');
    expect(trimLastLeaderBoardSeibanPrefixChar('A')).toBe('');
    expect(trimLastLeaderBoardSeibanPrefixChar('AB')).toBe('A');
  });

  it('clearLeaderBoardSeibanPrefix は空文字', () => {
    expect(clearLeaderBoardSeibanPrefix()).toBe('');
  });

  it('formatLeaderBoardSeibanPrefixDisplayPadded は表示用に padEnd（フィルタ値は変えない）', () => {
    expect(formatLeaderBoardSeibanPrefixDisplayPadded('')).toHaveLength(LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN);
    expect(formatLeaderBoardSeibanPrefixDisplayPadded('12')).toHaveLength(LEADER_BOARD_SEIBAN_PREFIX_MAX_LEN);
    expect(formatLeaderBoardSeibanPrefixDisplayPadded('12').startsWith('12')).toBe(true);
  });
});
