import { describe, expect, it } from 'vitest';

import { buildContentLibrary, countUsage, formatAgo, judgeDelivery, slotsOfSchedule } from './hubModel';

import type { SignageSchedule, SignageWebCapture } from '../../../api/client';

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '予定',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [1],
  startTime: '09:00',
  endTime: '12:00',
  priority: 0,
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

const full = (kind: string, config: Record<string, unknown> = {}) =>
  ({ layout: 'FULL', slots: [{ position: 'FULL', kind, config }] }) as never;

const capture = (partial: Partial<SignageWebCapture> = {}): SignageWebCapture => ({
  id: 'cap-1',
  name: '自主検査KPI',
  path: '/admin/kpi',
  viewportWidth: 1920,
  viewportHeight: 1080,
  waitMode: 'network_idle',
  waitSeconds: 3,
  hideSelectors: [],
  clipSelector: null,
  refreshIntervalSeconds: 300,
  enabled: true,
  lastCapturedAt: null,
  lastStatus: 'never',
  lastError: null,
  lastDurationMs: null,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

describe('slotsOfSchedule', () => {
  it('derives slots for legacy schedules without layoutConfig', () => {
    expect(slotsOfSchedule(schedule({ contentType: 'TOOLS' })).map((s) => s.kind)).toEqual(['loans']);
    expect(slotsOfSchedule(schedule({ contentType: 'PDF', pdfId: 'p1' })).map((s) => s.kind)).toEqual(['pdf']);
    expect(slotsOfSchedule(schedule({ contentType: 'SPLIT', pdfId: 'p1' })).map((s) => s.kind)).toEqual(['loans', 'pdf']);
  });
});

describe('countUsage', () => {
  it('counts only enabled schedules that reference the content', () => {
    const schedules = [
      schedule({ id: 'a', layoutConfig: full('web_page', { webCaptureId: 'cap-1' }) }),
      schedule({ id: 'b', layoutConfig: full('web_page', { webCaptureId: 'cap-1' }), enabled: false }),
      schedule({ id: 'c', layoutConfig: full('web_page', { webCaptureId: 'cap-2' }) }),
      schedule({ id: 'd' }),
    ];
    expect(countUsage(schedules, { type: 'web_page', webCaptureId: 'cap-1' })).toBe(1);
    expect(countUsage(schedules, { type: 'builtin', kind: 'loans' })).toBe(1);
    expect(countUsage(schedules, { type: 'pdf', pdfId: 'none' })).toBe(0);
  });
});

describe('buildContentLibrary', () => {
  it('lists used content first and flags failed captures', () => {
    const items = buildContentLibrary({
      schedules: [schedule({ layoutConfig: full('kiosk_leader_order_cards', { deviceScopeKey: 'x' }) })],
      webCaptures: [capture({ lastStatus: 'failed' })],
      pdfs: [],
      csvDashboards: [],
      visualizationDashboards: [],
    });
    expect(items[0]).toMatchObject({ name: '順位ボード・資源CDカード', usedCount: 1 });
    expect(items[1]).toMatchObject({ name: '自主検査KPI', kind: 'web_page', meta: 'ページ撮影 · 5分ごと', warning: '撮影に失敗' });
    expect(items.map((item) => item.name)).toContain('持出一覧');
  });
});

describe('judgeDelivery', () => {
  const now = new Date('2026-10-01T05:00:00.000Z');
  it('is ok within three render intervals (at least 90s), stale after, never without a record', () => {
    expect(judgeDelivery('2026-10-01T04:59:30.000Z', now, 30)).toEqual({ state: 'ok', secondsAgo: 30 });
    expect(judgeDelivery('2026-10-01T04:58:20.000Z', now, 30)).toEqual({ state: 'stale', secondsAgo: 100 });
    expect(judgeDelivery('2026-10-01T04:57:30.000Z', now, 60)).toEqual({ state: 'ok', secondsAgo: 150 });
    expect(judgeDelivery(null, now, 30)).toEqual({ state: 'never', secondsAgo: null });
  });

  it('formats elapsed time for people', () => {
    expect([formatAgo(30), formatAgo(720), formatAgo(7300), formatAgo(null)]).toEqual(['30秒前', '12分前', '2時間前', '記録なし']);
  });
});
