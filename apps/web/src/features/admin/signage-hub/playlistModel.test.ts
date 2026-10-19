import { describe, expect, it } from 'vitest';

import {
  buildPlaylist,
  buildQuickSchedulePayload,
  DEFAULT_QUICK_WHEN,
  formatWhen,
  isAlwaysSchedule,
  nextInRotation,
  normalizePagePath,
  planRemoveFromScreen,
  validateQuickWhen,
} from './playlistModel';

import type { SignageSchedule } from '../../../api/client';

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '予定',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00',
  endTime: '23:59',
  priority: 0,
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

describe('when labels', () => {
  it('calls an all-day every-day schedule "いつも" and describes the rest briefly', () => {
    expect(isAlwaysSchedule(schedule({}))).toBe(true);
    expect(formatWhen(schedule({}))).toBe('いつも');
    expect(formatWhen(schedule({ dayOfWeek: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '09:00' }))).toBe('平日 7:30–9:00');
    expect(formatWhen(schedule({ dayOfWeek: [6, 0] }))).toBe('土・日 終日');
    expect(formatWhen(schedule({ startTime: '13:00', endTime: '17:00' }))).toBe('毎日 13:00–17:00');
  });
});

describe('buildPlaylist', () => {
  const schedules = [
    schedule({ id: 'a', name: 'KPI' }),
    schedule({ id: 'b', name: '順位ボード' }),
    schedule({ id: 'morning', name: '持出一覧', dayOfWeek: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '09:00' }),
    schedule({ id: 'other', targetClientKeys: ['key-b'] }),
    schedule({ id: 'off', enabled: false }),
  ];

  it('lists what rotates now in rotation order, then off-hours items, and marks what is on air', () => {
    const playlist = buildPlaylist(schedules, 'key-a', { scheduleIds: ['b', 'a'], currentIndex: 1, secondsUntilSwitch: 12, isFallback: false });
    expect(playlist.map((item) => [item.scheduleId, item.isOnAir, item.isInRotation, item.whenLabel])).toEqual([
      ['b', false, true, 'いつも'],
      ['a', true, true, 'いつも'],
      ['morning', false, false, '平日 7:30–9:00'],
    ]);
  });

  it('marks the fallback schedule as on air but not as rotating', () => {
    const playlist = buildPlaylist(schedules, 'key-a', { scheduleIds: ['morning'], currentIndex: 0, secondsUntilSwitch: null, isFallback: true });
    expect(playlist.find((item) => item.scheduleId === 'morning')).toMatchObject({ isOnAir: true, isInRotation: false });
  });
});

describe('nextInRotation', () => {
  it('wraps around and is null when nothing rotates', () => {
    expect(nextInRotation({ scheduleIds: ['a', 'b'], currentIndex: 1, secondsUntilSwitch: 18, isFallback: false })).toEqual({ scheduleId: 'a', secondsUntilSwitch: 18 });
    expect(nextInRotation({ scheduleIds: ['a'], currentIndex: 0, secondsUntilSwitch: null, isFallback: false })).toBeNull();
    expect(nextInRotation(undefined)).toBeNull();
  });
});

describe('buildQuickSchedulePayload', () => {
  it('defaults to all screens, always, as one full-screen slot', () => {
    expect(
      buildQuickSchedulePayload({ name: ' 生産日程 ', content: { type: 'web_page', webCaptureId: 'cap-1' }, targetClientKeys: [], when: DEFAULT_QUICK_WHEN }),
    ).toEqual({
      name: '生産日程',
      contentType: 'TOOLS',
      pdfId: null,
      layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'web_page', config: { webCaptureId: 'cap-1' } }] },
      targetClientKeys: [],
      dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '00:00',
      endTime: '23:59',
      priority: 0,
      enabled: true,
    });
  });

  it('keeps the PDF id in the legacy fields and applies a chosen time window', () => {
    const payload = buildQuickSchedulePayload({
      name: '掲示',
      content: { type: 'pdf', pdfId: 'p1', displayMode: 'SINGLE', slideInterval: null },
      targetClientKeys: ['key-a'],
      when: { always: false, dayOfWeek: [5, 1], startTime: '13:00', endTime: '17:00' },
    });
    expect(payload).toMatchObject({ contentType: 'PDF', pdfId: 'p1', targetClientKeys: ['key-a'], dayOfWeek: [1, 5], startTime: '13:00', endTime: '17:00' });
    expect(payload.layoutConfig).toEqual({ layout: 'FULL', slots: [{ position: 'FULL', kind: 'pdf', config: { pdfId: 'p1', displayMode: 'SINGLE', slideInterval: null } }] });
  });
});

describe('planRemoveFromScreen', () => {
  it('deletes an all-screens schedule, narrows a multi-screen one, and deletes the last screen', () => {
    expect(planRemoveFromScreen({ targetClientKeys: [] }, 'key-a')).toEqual({ action: 'delete', affectsAllScreens: true });
    expect(planRemoveFromScreen({ targetClientKeys: ['key-a', 'key-b'] }, 'key-a')).toEqual({ action: 'update', targetClientKeys: ['key-b'] });
    expect(planRemoveFromScreen({ targetClientKeys: ['key-a'] }, 'key-a')).toEqual({ action: 'delete', affectsAllScreens: false });
  });
});

describe('validateQuickWhen', () => {
  it('needs days and a forward time range only when a time is chosen', () => {
    expect(validateQuickWhen(DEFAULT_QUICK_WHEN)).toBeNull();
    expect(validateQuickWhen({ always: false, dayOfWeek: [], startTime: '09:00', endTime: '17:00' })).toContain('曜日');
    expect(validateQuickWhen({ always: false, dayOfWeek: [1], startTime: '17:00', endTime: '09:00' })).toContain('終わりの時刻');
  });
});

describe('normalizePagePath', () => {
  const origin = 'https://pi5.example';

  it('keeps a path, adds a missing slash, and strips the origin of a same-site URL', () => {
    expect(normalizePagePath(' /admin/data-boards ', origin)).toEqual({ ok: true, path: '/admin/data-boards' });
    expect(normalizePagePath('kiosk/production-schedule', origin)).toEqual({ ok: true, path: '/kiosk/production-schedule' });
    expect(normalizePagePath('https://pi5.example/admin/kpi?tab=today', origin)).toEqual({ ok: true, path: '/admin/kpi?tab=today' });
  });

  it('refuses other sites and empty input with a reason', () => {
    expect(normalizePagePath('https://example.com/admin', origin)).toMatchObject({ ok: false });
    expect(normalizePagePath('  ', origin)).toMatchObject({ ok: false });
  });
});
