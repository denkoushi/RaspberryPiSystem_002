import { describe, expect, it } from 'vitest';

import {
  computeBasisDateUtc,
  computeOneYearAgoThresholdUtc,
  parseJstDateLike,
} from '../production-schedule-basis-date.js';

describe('production-schedule-basis-date', () => {
  it('parseJstDateLike: YYYY/M/D HH:mm をJSTとしてUTCへ変換する', () => {
    const parsed = parseJstDateLike('2026/1/8 8:13');
    expect(parsed).not.toBeNull();

    const expected = new Date(Date.UTC(2026, 0, 8, 8, 13, 0, 0) - 9 * 60 * 60 * 1000);
    expect(parsed?.toISOString()).toBe(expected.toISOString());
  });

  it('computeBasisDateUtc: updatedAtがoccurredAtより新しければupdatedAtを採用', () => {
    const occurredAtUtc = new Date('2026-02-18T00:00:00.000Z');
    const rowData = { updatedAt: '2026/2/18 12:00' };

    const basis = computeBasisDateUtc({ rowData, occurredAtUtc });
    // 2026/2/18 12:00 JST = 2026-02-18T03:00:00Z
    expect(basis.toISOString()).toBe('2026-02-18T03:00:00.000Z');
  });

  it('computeBasisDateUtc: updatedAtがoccurredAtより古い場合はoccurredAtを採用', () => {
    const occurredAtUtc = new Date('2026-02-18T05:00:00.000Z');
    const rowData = { updatedAt: '2026/2/18 12:00' }; // 03:00Z

    const basis = computeBasisDateUtc({ rowData, occurredAtUtc });
    expect(basis.toISOString()).toBe(occurredAtUtc.toISOString());
  });

  it('computeOneYearAgoThresholdUtc: JST基準で1年前を算出する', () => {
    // nowUtc=2026-02-19T00:00:00Z -> nowJst=2026-02-19T09:00:00(+09)
    // 1年前JST=2025-02-19T09:00:00(+09) -> thresholdUtc=2025-02-19T00:00:00Z
    const threshold = computeOneYearAgoThresholdUtc(new Date('2026-02-19T00:00:00.000Z'));
    expect(threshold.toISOString()).toBe('2025-02-19T00:00:00.000Z');
  });
});

