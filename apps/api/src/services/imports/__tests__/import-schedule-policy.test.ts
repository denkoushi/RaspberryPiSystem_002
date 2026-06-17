import { describe, expect, it } from 'vitest';

import type { BackupConfig } from '../../backup/backup-config.js';
import {
  detectGmailScheduleMinuteCollisions,
  expandGmailScheduleTriggerKeys,
} from '../import-schedule-policy.js';

function createConfig(csvImports: NonNullable<BackupConfig['csvImports']>): BackupConfig {
  return {
    storage: { provider: 'gmail', options: {} },
    targets: [],
    csvImports,
  };
}

describe('import-schedule-policy', () => {
  describe('expandGmailScheduleTriggerKeys', () => {
    it('expands comma and wildcard minute lists', () => {
      const triggers = expandGmailScheduleTriggerKeys('15,30,45 * * * *');
      expect(triggers?.has('15:0:0')).toBe(true);
      expect(triggers?.has('30:0:0')).toBe(true);
      expect(triggers?.has('45:0:0')).toBe(true);
      expect(triggers?.has('16:0:0')).toBe(false);
    });

    it('returns null when dayOfMonth or month is not *', () => {
      expect(expandGmailScheduleTriggerKeys('15 6 1 * 0')).toBeNull();
      expect(expandGmailScheduleTriggerKeys('15 6 * 1 0')).toBeNull();
    });
  });

  describe('detectGmailScheduleMinuteCollisions', () => {
    it('detects overlap between hourly multi-minute and weekly schedule', () => {
      const warnings = detectGmailScheduleMinuteCollisions(
        createConfig([
          {
            id: 'csv-import-measuring-instrument-loans',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'a' }],
            schedule: '15,30,45 * * * *',
            enabled: true,
            replaceExisting: false,
          },
          {
            id: 'csv-import-seiban-machine-name-supplement',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'b' }],
            schedule: '15 6 * * 0',
            enabled: true,
            replaceExisting: false,
          },
        ])
      );

      expect(warnings.some((warning) => warning.includes('csv-import-measuring-instrument-loans'))).toBe(true);
      expect(warnings.some((warning) => warning.includes('csv-import-seiban-machine-name-supplement'))).toBe(true);
    });

    it('does not warn when only minute matches but hour differs', () => {
      const warnings = detectGmailScheduleMinuteCollisions(
        createConfig([
          {
            id: 'schedule-a',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'a' }],
            schedule: '15 6 * * 0',
            enabled: true,
            replaceExisting: false,
          },
          {
            id: 'schedule-b',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'b' }],
            schedule: '15 7 * * 0',
            enabled: true,
            replaceExisting: false,
          },
        ])
      );

      expect(warnings).toEqual([]);
    });

    it('ignores disabled and non-gmail schedules', () => {
      const warnings = detectGmailScheduleMinuteCollisions(
        createConfig([
          {
            id: 'disabled-gmail',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'a' }],
            schedule: '15 6 * * 0',
            enabled: false,
            replaceExisting: false,
          },
          {
            id: 'dropbox-schedule',
            provider: 'dropbox',
            targets: [{ type: 'csvDashboards', source: 'a' }],
            schedule: '15 6 * * 0',
            enabled: true,
            replaceExisting: false,
          },
        ])
      );

      expect(warnings).toEqual([]);
    });

    it('warns when cron shape cannot be checked', () => {
      const warnings = detectGmailScheduleMinuteCollisions(
        createConfig([
          {
            id: 'unsupported-shape',
            provider: 'gmail',
            targets: [{ type: 'csvDashboards', source: 'a' }],
            schedule: '15 6 1 * 0',
            enabled: true,
            replaceExisting: false,
          },
        ])
      );

      expect(warnings).toEqual([
        'Gmail csvDashboards schedule "unsupported-shape" uses a cron shape that cannot be checked for collisions (dayOfMonth/month must be * for detection)',
      ]);
    });
  });
});
