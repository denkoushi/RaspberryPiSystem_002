import { slotMatchesSource, slotsOfSchedule, type LibrarySource } from '../signage-hub/hubModel';

import type { CsvDashboard, SignageSchedule, VisualizationDashboard } from '../../../api/client';

export type BoardType = 'graph' | 'table';

export interface BoardSelection {
  type: BoardType;
  id: string;
}

export interface BoardListItem extends BoardSelection {
  name: string;
  enabled: boolean;
  /** このボードを使っている有効なサイネージ予定の数 */
  usedCount: number;
}

export interface BoardUsage {
  scheduleId: string;
  scheduleName: string;
  days: string;
  time: string;
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function sourceOf(selection: BoardSelection): LibrarySource {
  return selection.type === 'graph'
    ? { type: 'visualization', visualizationDashboardId: selection.id }
    : { type: 'csv_dashboard', csvDashboardId: selection.id };
}

/** 曜日の並びを「月〜金」「月・水・金」のように短く表す */
export function formatDays(days: number[]): string {
  const ordered = DAY_ORDER.filter((day) => days.includes(day));
  if (ordered.length === 0) return '曜日なし';
  if (ordered.length === 7) return '毎日';
  const positions = ordered.map((day) => DAY_ORDER.indexOf(day));
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (contiguous && ordered.length >= 3) {
    return `${DAY_LABELS[ordered[0]]}〜${DAY_LABELS[ordered[ordered.length - 1]]}`;
  }
  return ordered.map((day) => DAY_LABELS[day]).join('・');
}

/** ボードを使っている有効なサイネージ予定（純関数） */
export function listBoardUsage(schedules: SignageSchedule[], selection: BoardSelection): BoardUsage[] {
  const source = sourceOf(selection);
  return schedules
    .filter((schedule) => schedule.enabled && slotsOfSchedule(schedule).some((slot) => slotMatchesSource(slot, source)))
    .map((schedule) => ({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      days: formatDays(schedule.dayOfWeek),
      time: `${schedule.startTime}–${schedule.endTime}`,
    }));
}

/** 左の一覧（グラフと表をまとめて、使用中を先に名前順で並べる） */
export function buildBoardList(
  visualizationDashboards: VisualizationDashboard[],
  csvDashboards: CsvDashboard[],
  schedules: SignageSchedule[],
): BoardListItem[] {
  const items: BoardListItem[] = [
    ...visualizationDashboards.map((dashboard) => ({ type: 'graph' as const, id: dashboard.id, name: dashboard.name, enabled: dashboard.enabled })),
    ...csvDashboards.map((dashboard) => ({ type: 'table' as const, id: dashboard.id, name: dashboard.name, enabled: dashboard.enabled })),
  ].map((item) => ({ ...item, usedCount: listBoardUsage(schedules, item).length }));
  return items.sort(
    (a, b) => Number(b.usedCount > 0) - Number(a.usedCount > 0) || a.name.localeCompare(b.name, 'ja'),
  );
}
