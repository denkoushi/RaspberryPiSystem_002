import { describe, expect, it } from 'vitest';

import {
  buildSensorTimeline,
  computeSensorDayBase,
  countSensorHints,
  describeGmailSchedule,
  minuteToTimeText,
  numberOrNull,
  placeBeside,
  planSignalUpload,
  timeTextToMinute
} from './machineSignalAdminModel';

describe('machineSignalAdminModel', () => {
  it('converts between minutes and a clock text', () => {
    expect(minuteToTimeText(495)).toBe('08:15');
    expect(minuteToTimeText(null)).toBe('');
    expect(timeTextToMinute('08:15')).toBe(495);
    expect(timeTextToMinute('')).toBeNull();
    expect(timeTextToMinute('24:00')).toBeNull();
  });

  it('reads an optional non-negative number', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('7.5')).toBe(7.5);
    expect(numberOrNull('-1')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
  });

  it('keeps only daily report files and splits them into batches of fifty', () => {
    const files = [
      ...Array.from({ length: 120 }, (_, index) => ({ name: `DailySummary_Signal${index + 1}_20241001.csv` })),
      { name: 'desktop.ini' },
      { name: 'memo.csv' }
    ];
    const plan = planSignalUpload(files);
    expect(plan.batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(plan.ignored).toBe(2);
  });
});

describe('sensor preview and hints', () => {
  const sensor = {
    lampPatterns: [
      { pattern: '112', stateNames: ['設備稼働'], autoCategory: 'RUN' as const },
      { pattern: '122', stateNames: ['稼働中停止'], autoCategory: 'RUN' as const },
      { pattern: '211', stateNames: ['異常停止'], autoCategory: 'ALARM_STOP' as const }
    ],
    latestSegments: [
      [0, 7_200, 0],
      [7_200, 120, 1],
      [7_320, 3_600, 0],
      [10_920, 1_800, 2]
    ] as Array<[number, number, number]>
  };

  it('paints the latest day with the automatic categories, then with an override', () => {
    expect(buildSensorTimeline(sensor, {}).map((segment) => segment[2])).toEqual([0, 0, 0, 3]);
    expect(buildSensorTimeline(sensor, { '122': 'STOP' }).map((segment) => segment[2])).toEqual([0, 2, 0, 3]);
  });

  it('collects run, red lamp and each stop after the first run, counting the unrecorded tail as a stop', () => {
    const base = computeSensorDayBase(buildSensorTimeline(sensor, { '122': 'STOP' }));
    expect(base).toEqual({
      hasRecord: true,
      runSeconds: 10_800,
      alarmSeconds: 1_800,
      alarmCount: 1,
      stopSeconds: [120, 86_400 - 10_920]
    });
    expect(computeSensorDayBase([])).toMatchObject({ hasRecord: false, runSeconds: 0, stopSeconds: [] });
  });

  it('counts how many sensors each hint would catch, and follows the thresholds', () => {
    const thresholds = {
      shortStopMaxSeconds: 300,
      longStopMinSeconds: 10_800,
      shortStopCountForHint: 10,
      alarmSecondsForHint: 1_800,
      alarmCountForHint: 10,
      barelyRanMaxSeconds: 3_600,
      goodRunMinSeconds: 57_600,
      worseningPercent: 30
    };
    const bases = [
      { hasRecord: true, runSeconds: 10_800, alarmSeconds: 1_800, alarmCount: 1, stopSeconds: [120, 75_480] },
      { hasRecord: true, runSeconds: 600, alarmSeconds: 0, alarmCount: 0, stopSeconds: [85_800] },
      { hasRecord: true, runSeconds: 80_000, alarmSeconds: 0, alarmCount: 0, stopSeconds: [] },
      { hasRecord: false, runSeconds: 0, alarmSeconds: 0, alarmCount: 0, stopSeconds: [] }
    ];
    expect(countSensorHints(bases, thresholds)).toEqual({ ALARM: 1, SHORT_STOPS: 0, LONG_STOP: 0, BARELY_RAN: 1, GOOD: 1 });
    expect(countSensorHints(bases, { ...thresholds, alarmSecondsForHint: 3_600 })).toMatchObject({ ALARM: 0, LONG_STOP: 1 });
  });
});

describe('describeGmailSchedule', () => {
  it('reads an hourly schedule as a minute and the next run', () => {
    expect(describeGmailSchedule('47 * * * *', new Date(2026, 9, 2, 15, 21))).toEqual({ label: '毎時 :47', next: '15:47' });
    expect(describeGmailSchedule('47 * * * *', new Date(2026, 9, 2, 15, 47))).toEqual({ label: '毎時 :47', next: '16:47' });
  });

  it('shows other schedules as written and says when none is set', () => {
    expect(describeGmailSchedule('17 6 * * *', new Date())).toEqual({ label: '17 6 * * *', next: null });
    expect(describeGmailSchedule(null, new Date())).toEqual({ label: '未設定', next: null });
  });
});

describe('placeBeside', () => {
  const viewport = { width: 1_440, height: 900 };
  const size = { width: 452, height: 600 };

  it('opens right next to the row, ten pixels away', () => {
    expect(placeBeside({ left: 324, right: 570, top: 220, bottom: 248 }, size, viewport)).toEqual({ left: 580, top: 168 });
  });

  it('flips to the left when the right side has no room, and stays inside the screen', () => {
    expect(placeBeside({ left: 1_100, right: 1_380, top: 860, bottom: 888 }, size, viewport)).toEqual({ left: 638, top: 292 });
  });

  it('drops below the button for a bulk selection made from the toolbar', () => {
    expect(placeBeside({ left: 700, right: 860, top: 70, bottom: 100 }, { width: 400, height: 260 }, viewport, 'below')).toEqual({
      left: 460,
      top: 108
    });
  });
});
