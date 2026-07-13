import { describe, expect, it } from 'vitest';

import { formatDeployNoticeCountdown, remainingDeployNoticeSeconds } from './deployPreNotice';

describe('deploy pre-notice countdown', () => {
  it('uses the server-confirmed deadline and never shows a negative countdown', () => {
    expect(remainingDeployNoticeSeconds('2026-07-13T00:01:00.000Z', Date.parse('2026-07-13T00:00:00.100Z')))
      .toBe(60);
    expect(remainingDeployNoticeSeconds('2026-07-13T00:01:00.000Z', Date.parse('2026-07-13T00:01:01.000Z')))
      .toBe(0);
  });

  it('keeps the pre-acknowledgement and final countdown copy explicit', () => {
    expect(formatDeployNoticeCountdown(null)).toBe('開始時刻を確認しています');
    expect(formatDeployNoticeCountdown(60)).toBe('更新開始まで 01:00');
    expect(formatDeployNoticeCountdown(0)).toBe('まもなく更新を開始します');
  });
});
