import type { SignageSchedule } from '../../../api/client';

/** タイムラインの色分けに使うコンテンツの種類 */
export type SignageContentKind = 'web_page' | 'data' | 'pdf' | 'chat';

export interface WeekTimelineBlock {
  scheduleId: string;
  name: string;
  kind: SignageContentKind;
  startMinute: number;
  endMinute: number;
  /** 同じ時間に重なる予定を縦に並べるための段（0 始まり）と、その重なりの段数 */
  lane: number;
  laneCount: number;
  isOnAir: boolean;
  isPast: boolean;
}

export interface WeekTimelineDay {
  dayOfWeek: number;
  label: string;
  isToday: boolean;
  blocks: WeekTimelineBlock[];
}

export interface WeekTimeline {
  /** 表示範囲（分）。既定は 6:00〜22:00 で、範囲外の予定があれば広げる */
  startMinute: number;
  endMinute: number;
  nowMinute: number;
  days: WeekTimelineDay[];
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
/** 月曜始まりで表示する */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_START_MINUTE = 6 * 60;
const DEFAULT_END_MINUTE = 22 * 60;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

/** サーバーと同じ基準（既定 Asia/Tokyo）で、今の曜日と 0:00 からの分を求める */
export function getSignageNow(now: Date, timeZone = 'Asia/Tokyo'): { dayOfWeek: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(pick('hour')) % 24;
  return { dayOfWeek: WEEKDAY_INDEX[pick('weekday')] ?? 0, minute: hour * 60 + Number(pick('minute')) };
}

/** 空 = 全端末向け。値があるときは列挙された端末だけ（サーバーの signageScheduleMatchesClientKey と同じ規則） */
export function scheduleTargetsClient(schedule: Pick<SignageSchedule, 'targetClientKeys'>, clientKey: string | null): boolean {
  const keys = schedule.targetClientKeys ?? [];
  if (keys.length === 0) return true;
  return clientKey !== null && keys.includes(clientKey);
}

export function classifyScheduleContent(schedule: Pick<SignageSchedule, 'contentType' | 'layoutConfig'>): SignageContentKind {
  const layout = schedule.layoutConfig;
  if (!layout) return schedule.contentType === 'PDF' ? 'pdf' : 'data';
  if (layout.layout === 'CANVAS' || ('a2ui' in layout && layout.a2ui)) return 'chat';
  const kinds = layout.slots.map((slot) => slot.kind);
  if (kinds.includes('web_page')) return 'web_page';
  if (kinds.length > 0 && kinds.every((kind) => kind === 'pdf')) return 'pdf';
  return 'data';
}

function assignLanes(blocks: WeekTimelineBlock[]): void {
  blocks.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  let cluster: WeekTimelineBlock[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const closeCluster = () => {
    cluster.forEach((block) => {
      block.laneCount = laneEnds.length;
    });
    cluster = [];
    laneEnds.length = 0;
  };
  for (const block of blocks) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinute);
    } else {
      laneEnds[lane] = block.endMinute;
    }
    block.lane = lane;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  if (cluster.length > 0) closeCluster();
}

/**
 * 週間スケジュールの描画データを作る（純関数）。
 * 同じ時間に複数の予定が当たる場合、サーバーは一定間隔で交互に表示するので、段を分けて両方見せる。
 */
export function buildWeekTimelineBlocks(
  schedules: SignageSchedule[],
  clientKey: string | null,
  now: Date,
  timeZone = 'Asia/Tokyo',
): WeekTimeline {
  const current = getSignageNow(now, timeZone);
  const visible = schedules.filter((schedule) => schedule.enabled && scheduleTargetsClient(schedule, clientKey));
  let startMinute = DEFAULT_START_MINUTE;
  let endMinute = DEFAULT_END_MINUTE;

  const days = DAY_ORDER.map((dayOfWeek): WeekTimelineDay => {
    const isToday = dayOfWeek === current.dayOfWeek;
    const blocks: WeekTimelineBlock[] = [];
    for (const schedule of visible) {
      if (!schedule.dayOfWeek.includes(dayOfWeek)) continue;
      const start = parseTimeToMinutes(schedule.startTime);
      const end = parseTimeToMinutes(schedule.endTime);
      if (start === null || end === null || end <= start) continue;
      startMinute = Math.min(startMinute, Math.floor(start / 60) * 60);
      endMinute = Math.max(endMinute, Math.ceil(end / 60) * 60);
      blocks.push({
        scheduleId: schedule.id,
        name: schedule.name,
        kind: classifyScheduleContent(schedule),
        startMinute: start,
        endMinute: end,
        lane: 0,
        laneCount: 1,
        isOnAir: isToday && current.minute >= start && current.minute < end,
        isPast: isToday && end <= current.minute,
      });
    }
    assignLanes(blocks);
    return { dayOfWeek, label: DAY_LABELS[dayOfWeek], isToday, blocks };
  });

  return { startMinute, endMinute, nowMinute: current.minute, days };
}

export interface TodaySummary {
  todayBlockCount: number;
  onAirNames: string[];
  next: { startMinute: number; name: string } | null;
}

export function summarizeToday(timeline: WeekTimeline): TodaySummary {
  const today = timeline.days.find((day) => day.isToday);
  const blocks = today?.blocks ?? [];
  const upcoming = blocks
    .filter((block) => block.startMinute > timeline.nowMinute)
    .sort((a, b) => a.startMinute - b.startMinute)[0];
  return {
    todayBlockCount: blocks.length,
    onAirNames: blocks.filter((block) => block.isOnAir).map((block) => block.name),
    next: upcoming ? { startMinute: upcoming.startMinute, name: upcoming.name } : null,
  };
}

export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** 週間スケジュールの表に出ない予定（無効、または選択中の端末向けでない）を理由つきで返す */
export function listOffTimelineSchedules(
  schedules: SignageSchedule[],
  clientKey: string | null,
): Array<{ scheduleId: string; name: string; reason: string }> {
  return schedules
    .filter((schedule) => !schedule.enabled || !scheduleTargetsClient(schedule, clientKey))
    .map((schedule) => ({
      scheduleId: schedule.id,
      name: schedule.name,
      reason: schedule.enabled ? '他の端末' : '無効',
    }));
}
