import { describe, expect, it } from 'vitest';

import { buildLeaderboardBoardCacheKey } from '../leaderboardBoardCacheKey';

describe('buildLeaderboardBoardCacheKey', () => {
  it('siteKey と paramsKey を結合する', () => {
    expect(buildLeaderboardBoardCacheKey('site-a', '{"pageSize":80}')).toBe(
      'site-a\u0001{"pageSize":80}'
    );
  });

  it('空 siteKey は paramsKey のみ', () => {
    expect(buildLeaderboardBoardCacheKey('', '{"q":"x"}')).toBe('{"q":"x"}');
  });

  it('schedule 未就绪（paramsKey undefined）でも落ちず空キーを返す', () => {
    expect(buildLeaderboardBoardCacheKey('site-a', undefined)).toBe('site-a');
    expect(buildLeaderboardBoardCacheKey(undefined, undefined)).toBe('');
  });
});
