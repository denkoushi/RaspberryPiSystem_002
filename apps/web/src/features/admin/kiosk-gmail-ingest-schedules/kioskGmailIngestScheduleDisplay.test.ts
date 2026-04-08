import { describe, expect, it } from 'vitest';

import {
  formatKioskGmailIngestCronExpression,
  formatKioskGmailIngestEnabledLabel,
  normalizeKioskGmailIngestSchedules,
} from './kioskGmailIngestScheduleDisplay';

describe('kioskGmailIngestScheduleDisplay', () => {
  it('formatKioskGmailIngestEnabledLabel', () => {
    expect(formatKioskGmailIngestEnabledLabel(true)).toBe('有効');
    expect(formatKioskGmailIngestEnabledLabel(false)).toBe('無効');
  });

  it('formatKioskGmailIngestCronExpression', () => {
    expect(formatKioskGmailIngestCronExpression('0 * * * *')).toBe('0 * * * *');
    expect(formatKioskGmailIngestCronExpression('  ')).toBe('—');
    expect(formatKioskGmailIngestCronExpression(undefined)).toBe('—');
  });

  it('normalizeKioskGmailIngestSchedules', () => {
    expect(normalizeKioskGmailIngestSchedules(undefined)).toEqual([]);
    expect(normalizeKioskGmailIngestSchedules([])).toEqual([]);
    expect(
      normalizeKioskGmailIngestSchedules([
        {
          id: 'a',
          subjectPattern: 'x',
          schedule: '0 0 * * *',
          enabled: true,
        },
        /** id が空の行は表示対象外（壊れた設定の混入に耐える） */
        {
          id: '',
          subjectPattern: 'y',
          schedule: '0 1 * * *',
          enabled: false,
        },
      ])
    ).toEqual([
      {
        id: 'a',
        subjectPattern: 'x',
        schedule: '0 0 * * *',
        enabled: true,
      },
    ]);
  });
});
