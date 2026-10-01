import { describe, expect, it } from 'vitest';

import { buildBoardList, formatDays, listBoardUsage } from './boardModel';

import type { CsvDashboard, SignageSchedule, VisualizationDashboard } from '../../../api/client';

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '朝の表示',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [1, 2, 3, 4, 5],
  startTime: '07:30',
  endTime: '09:00',
  priority: 0,
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});
const full = (kind: string, config: Record<string, unknown>) =>
  ({ layout: 'FULL', slots: [{ position: 'FULL', kind, config }] }) as never;
const split = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  ({ layout: 'SPLIT', slots: [{ position: 'LEFT', ...left }, { position: 'RIGHT', ...right }] }) as never;

describe('formatDays', () => {
  it('shortens runs and lists scattered days Monday-first', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('月〜金');
    expect(formatDays([0, 6])).toBe('土・日');
    expect(formatDays([1, 3, 5])).toBe('月・水・金');
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe('毎日');
    expect(formatDays([])).toBe('曜日なし');
  });
});

describe('listBoardUsage', () => {
  const schedules = [
    schedule({ id: 'a', layoutConfig: full('visualization', { visualizationDashboardId: 'v1' }) }),
    schedule({
      id: 'b',
      name: '左右',
      layoutConfig: split({ kind: 'csv_dashboard', config: { csvDashboardId: 'c1' } }, { kind: 'visualization', config: { visualizationDashboardId: 'v1' } }),
    }),
    schedule({ id: 'off', enabled: false, layoutConfig: full('visualization', { visualizationDashboardId: 'v1' }) }),
  ];

  it('finds enabled schedules that show the board in any slot', () => {
    expect(listBoardUsage(schedules, { type: 'graph', id: 'v1' }).map((usage) => usage.scheduleId)).toEqual(['a', 'b']);
    expect(listBoardUsage(schedules, { type: 'table', id: 'c1' })).toEqual([
      { scheduleId: 'b', scheduleName: '左右', days: '月〜金', time: '07:30–09:00' },
    ]);
    expect(listBoardUsage(schedules, { type: 'table', id: 'none' })).toEqual([]);
  });

  it('lists used boards first, then by name', () => {
    const viz = [{ id: 'v1', name: 'ん未点検', enabled: true }, { id: 'v2', name: 'あ計測', enabled: false }] as VisualizationDashboard[];
    const csv = [{ id: 'c9', name: 'い日程', enabled: true }] as CsvDashboard[];
    expect(buildBoardList(viz, csv, schedules).map((item) => [item.id, item.usedCount])).toEqual([
      ['v1', 2],
      ['v2', 0],
      ['c9', 0],
    ]);
  });
});
