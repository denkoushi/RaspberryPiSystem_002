import { describe, expect, it } from 'vitest';

import {
  buildWeekTimelineBlocks,
  classifyScheduleContent,
  formatMinute,
  getSignageNow,
  listOffTimelineSchedules,
  scheduleTargetsClient,
  summarizeToday,
} from './weekTimelineModel';

import type { SignageSchedule } from '../../../api/client';

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '予定',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [1, 2, 3, 4, 5],
  startTime: '09:00',
  endTime: '12:00',
  priority: 0,
  enabled: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...partial,
});

// 2026-09-30 は水曜。05:32Z = JST 14:32
const WED_1432_JST = new Date('2026-09-30T05:32:00.000Z');

describe('getSignageNow', () => {
  it('uses the signage time zone, not the browser one', () => {
    expect(getSignageNow(WED_1432_JST)).toEqual({ dayOfWeek: 3, minute: 14 * 60 + 32 });
    // JST では日付が変わっている
    expect(getSignageNow(new Date('2026-09-30T15:10:00.000Z'))).toEqual({ dayOfWeek: 4, minute: 10 });
  });
});

describe('scheduleTargetsClient', () => {
  it('treats an empty target list as all devices', () => {
    expect(scheduleTargetsClient({ targetClientKeys: [] }, 'key-a')).toBe(true);
    expect(scheduleTargetsClient({ targetClientKeys: ['key-b'] }, 'key-a')).toBe(false);
    expect(scheduleTargetsClient({ targetClientKeys: ['key-b'] }, null)).toBe(false);
  });
});

describe('classifyScheduleContent', () => {
  it('classifies by slot kinds', () => {
    const full = (kind: string) =>
      schedule({ layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind, config: {} }] } as never });
    expect(classifyScheduleContent(full('web_page'))).toBe('web_page');
    expect(classifyScheduleContent(full('pdf'))).toBe('pdf');
    expect(classifyScheduleContent(full('self_inspection_machine_board'))).toBe('data');
    expect(classifyScheduleContent(schedule({ contentType: 'PDF' }))).toBe('pdf');
    expect(
      classifyScheduleContent(
        schedule({ layoutConfig: { layout: 'CANVAS', width: 1920, height: 1080, backgroundColor: '#000', elements: [] } }),
      ),
    ).toBe('chat');
  });
});

describe('buildWeekTimelineBlocks', () => {
  it('lays out Monday-first days, marks today, on-air and past blocks', () => {
    const timeline = buildWeekTimelineBlocks(
      [
        schedule({ id: 'am', name: '部品別進捗', startTime: '09:00', endTime: '12:00' }),
        schedule({ id: 'pm', name: '自主検査KPI', startTime: '13:00', endTime: '17:00' }),
        schedule({ id: 'eve', name: '順位ボード', startTime: '17:00', endTime: '20:00' }),
      ],
      'key-a',
      WED_1432_JST,
    );
    expect(timeline.days.map((day) => day.label).join('')).toBe('月火水木金土日');
    const today = timeline.days.find((day) => day.isToday)!;
    expect(today.label).toBe('水');
    expect(today.blocks.map((b) => [b.scheduleId, b.isPast, b.isOnAir])).toEqual([
      ['am', true, false],
      ['pm', false, true],
      ['eve', false, false],
    ]);
    expect(timeline.days.find((day) => day.label === '日')!.blocks).toEqual([]);
    expect([timeline.startMinute, timeline.endMinute]).toEqual([6 * 60, 22 * 60]);
  });

  it('hides disabled schedules and schedules for other devices', () => {
    const timeline = buildWeekTimelineBlocks(
      [
        schedule({ id: 'mine', targetClientKeys: ['key-a'] }),
        schedule({ id: 'other', targetClientKeys: ['key-b'] }),
        schedule({ id: 'off', enabled: false }),
        schedule({ id: 'broken', startTime: '18:00', endTime: '09:00' }),
      ],
      'key-a',
      WED_1432_JST,
    );
    expect(timeline.days[0].blocks.map((b) => b.scheduleId)).toEqual(['mine']);
  });

  it('puts overlapping schedules on separate lanes and keeps later blocks on one lane', () => {
    const timeline = buildWeekTimelineBlocks(
      [
        schedule({ id: 'a', startTime: '09:00', endTime: '12:00' }),
        schedule({ id: 'b', startTime: '10:00', endTime: '11:00' }),
        schedule({ id: 'c', startTime: '13:00', endTime: '14:00' }),
      ],
      null,
      WED_1432_JST,
    );
    const byId = Object.fromEntries(timeline.days[0].blocks.map((b) => [b.scheduleId, [b.lane, b.laneCount]]));
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });

  it('widens the visible range for early or late schedules', () => {
    const timeline = buildWeekTimelineBlocks(
      [schedule({ startTime: '04:30', endTime: '23:15' })],
      null,
      WED_1432_JST,
    );
    expect([timeline.startMinute, timeline.endMinute]).toEqual([4 * 60, 24 * 60]);
  });
});

describe('summarizeToday', () => {
  it('reports what is on air and what comes next', () => {
    const timeline = buildWeekTimelineBlocks(
      [
        schedule({ id: 'pm', name: '自主検査KPI', startTime: '13:00', endTime: '17:00' }),
        schedule({ id: 'eve', name: '順位ボード', startTime: '17:00', endTime: '20:00' }),
      ],
      null,
      WED_1432_JST,
    );
    expect(summarizeToday(timeline)).toEqual({
      todayBlockCount: 2,
      onAirNames: ['自主検査KPI'],
      next: { startMinute: 17 * 60, name: '順位ボード' },
    });
    expect(formatMinute(17 * 60)).toBe('17:00');
  });
});

describe('listOffTimelineSchedules', () => {
  it('lists disabled schedules and schedules for other devices so they stay editable', () => {
    expect(
      listOffTimelineSchedules(
        [
          schedule({ id: 'shown' }),
          schedule({ id: 'off', name: '休止中', enabled: false }),
          schedule({ id: 'other', name: '事務所用', targetClientKeys: ['key-b'] }),
        ],
        'key-a',
      ),
    ).toEqual([
      { scheduleId: 'off', name: '休止中', reason: '無効' },
      { scheduleId: 'other', name: '事務所用', reason: '他の端末' },
    ]);
  });
});
