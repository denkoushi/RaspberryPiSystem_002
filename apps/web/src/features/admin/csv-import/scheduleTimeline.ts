/**
 * CSV取込スケジュールを「1日の時刻表」として扱うための純粋関数群。
 *
 * 重なりの定義は API の GmailImportOrchestrator に合わせる:
 * Gmail csvDashboards 取込は全体で1本ずつしか走らず、発火時に別の取込が実行中なら後続はスキップされる。
 */

export const MINUTES_PER_DAY = 1440;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
export const INTERVAL_CHOICES = [5, 10, 15, 20, 30, 60];

/** 実績がない取込の仮の所要時間 */
export const DEFAULT_DURATION_SEC = 60;
/** これ以上かかる取込を「長い取込」として、直後の時刻も警告する */
export const LONG_RUN_MINUTES = 2;
/** 長い取込の終了から、この分数以内の発火を「直後」とする */
export const AFTER_LONG_GUARD_MINUTES = 2;

export type ScheduleTiming = {
  /** 発火する分（昇順） */
  minutes: number[];
  /** 発火する時（昇順）。null は毎時 */
  hours: number[] | null;
  /** 発火する曜日（昇順、0=日） */
  days: number[];
};

export type TimelineEntry = ScheduleTiming & {
  id: string;
  name: string;
  enabled: boolean;
  /** Gmail csvDashboards 取込（1本ずつ走る順番待ちの対象）か */
  gated: boolean;
  durationSec: number;
  /** cron を画面で扱えるか（日・月指定などは false） */
  editable: boolean;
};

export type ConflictLevel = 'hard' | 'soft';

export type Conflict = {
  /** スキップされる（または直後に来る）側 */
  victimId: string;
  /** 先に走っている側 */
  causeId: string;
  /** victim の発火時刻（0時からの分） */
  at: number;
  /** cause の発火時刻 */
  causeAt: number;
  level: ConflictLevel;
  /** 同じ分に発火 */
  same: boolean;
};

function expandPart(part: string, min: number, max: number): number[] | null {
  const range = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = range[3] ? Number(range[3]) : 1;
    if (step <= 0 || start < min || end > max || start > end) return null;
    const values: number[] = [];
    for (let v = start; v <= end; v += step) values.push(v);
    return values;
  }
  if (!/^\d+$/.test(part)) return null;
  const value = Number(part);
  return value >= min && value <= max ? [value] : null;
}

function expandField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  if (field === '*' || field.startsWith('*/')) {
    const step = field === '*' ? 1 : Number(field.slice(2));
    if (!Number.isInteger(step) || step <= 0) return null;
    for (let v = min; v <= max; v += step) values.add(v);
  } else {
    for (const part of field.split(',')) {
      const expanded = expandPart(part.trim(), min, max);
      if (!expanded) return null;
      expanded.forEach((v) => values.add(v));
    }
  }
  return [...values].sort((a, b) => a - b);
}

/** cron（分 時 日 月 曜日）を時刻表に変換する。日・月指定や不正な形は null */
export function parseCronTiming(cron: string | undefined): ScheduleTiming | null {
  const parts = (cron ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== '*' || month !== '*') return null;
  const minutes = expandField(minuteField, 0, 59);
  const hours = hourField === '*' ? null : expandField(hourField, 0, 23);
  const days = expandField(dayOfWeek, 0, 6);
  if (!minutes || !days || (hourField !== '*' && !hours)) return null;
  if (minutes.length === 0 || days.length === 0) return null;
  return { minutes, hours, days };
}

/** 分リストが等間隔なら間隔を返す（1個だけなら60） */
export function intervalOf(timing: ScheduleTiming): number | null {
  const { minutes } = timing;
  if (timing.hours !== null) return null;
  if (minutes.length === 1) return 60;
  const gap = minutes[1] - minutes[0];
  for (let i = 2; i < minutes.length; i += 1) {
    if (minutes[i] - minutes[i - 1] !== gap) return null;
  }
  return minutes[minutes.length - 1] + gap >= 60 ? gap : null;
}

export function formatCronTiming(timing: ScheduleTiming): string {
  const days = timing.days.length === 7 ? '*' : timing.days.join(',');
  const hours = timing.hours === null ? '*' : timing.hours.join(',');
  const interval = intervalOf(timing);
  const isPlainStep =
    interval !== null && interval < 60 && timing.minutes[0] === 0 && timing.minutes.length * interval === 60;
  const minutes = isPlainStep ? `*/${interval}` : timing.minutes.join(',');
  return `${minutes} ${hours} * * ${days}`;
}

export function timingEquals(a: ScheduleTiming, b: ScheduleTiming): boolean {
  return formatCronTiming(a) === formatCronTiming(b);
}

/** その曜日に発火する時刻（0時からの分、昇順） */
export function firesOn(entry: TimelineEntry, day: number): number[] {
  if (!entry.enabled || !entry.editable || !entry.days.includes(day)) return [];
  const hours = entry.hours ?? Array.from({ length: 24 }, (_, h) => h);
  const fires: number[] = [];
  for (const h of hours) for (const m of entry.minutes) fires.push(h * 60 + m);
  return fires;
}

type RunEvent = { id: string; start: number; end: number };

function gatedEvents(entries: TimelineEntry[], day: number, exceptId?: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const entry of entries) {
    if (!entry.gated || entry.id === exceptId) continue;
    for (const start of firesOn(entry, day)) {
      events.push({ id: entry.id, start, end: start + entry.durationSec / 60 });
    }
  }
  return events;
}

function classify(victim: RunEvent, cause: RunEvent): Conflict | null {
  if (cause.start <= victim.start && victim.start < cause.end) {
    return {
      victimId: victim.id,
      causeId: cause.id,
      at: victim.start,
      causeAt: cause.start,
      level: 'hard',
      same: victim.start === cause.start
    };
  }
  const isLong = cause.end - cause.start >= LONG_RUN_MINUTES;
  if (isLong && cause.end <= victim.start && victim.start < cause.end + AFTER_LONG_GUARD_MINUTES) {
    return { victimId: victim.id, causeId: cause.id, at: victim.start, causeAt: cause.start, level: 'soft', same: false };
  }
  return null;
}

/** その曜日の重なり（hard）と、長い取込の直後（soft）を列挙する */
export function findConflicts(entries: TimelineEntry[], day: number): Conflict[] {
  const events = gatedEvents(entries, day);
  const conflicts: Conflict[] = [];
  for (const victim of events) {
    for (const cause of events) {
      if (victim.id === cause.id) continue;
      const conflict = classify(victim, cause);
      if (conflict) conflicts.push(conflict);
    }
  }
  return conflicts;
}

export function worstLevel(conflicts: Conflict[]): ConflictLevel | null {
  if (conflicts.some((c) => c.level === 'hard')) return 'hard';
  return conflicts.length > 0 ? 'soft' : null;
}

/** 取込の組み合わせ単位で数える（同じ組が毎時重なっても1件） */
export function countConflictPairs(conflicts: Conflict[]): { hard: number; soft: number } {
  const hard = new Set<string>();
  const soft = new Set<string>();
  for (const c of conflicts) {
    (c.level === 'hard' ? hard : soft).add([c.victimId, c.causeId].sort().join('|'));
  }
  hard.forEach((key) => soft.delete(key));
  return { hard: hard.size, soft: soft.size };
}

export function involves(conflict: Conflict, id: string): boolean {
  return conflict.victimId === id || conflict.causeId === id;
}

const mod = (value: number, base: number) => ((value % base) + base) % base;
const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

function isSingleTime(timing: ScheduleTiming): boolean {
  return timing.hours !== null && timing.hours.length === 1 && timing.minutes.length === 1;
}

/** 全ての発火を delta 分ずらす。1日1回の取込は時をまたぐ */
export function shiftTiming<T extends ScheduleTiming>(timing: T, delta: number): T {
  if (isSingleTime(timing)) {
    const time = mod(timing.hours![0] * 60 + timing.minutes[0] + delta, MINUTES_PER_DAY);
    return { ...timing, hours: [Math.floor(time / 60)], minutes: [time % 60] };
  }
  return { ...timing, minutes: sortedUnique(timing.minutes.map((m) => mod(m + delta, 60))) };
}

/** 1時間の盤面で、ある目印を fromMinute から toMinute へ動かす */
export function moveMarker<T extends ScheduleTiming>(timing: T, fromMinute: number, toMinute: number): T {
  if (isSingleTime(timing)) return { ...timing, minutes: [toMinute] };
  return shiftTiming(timing, toMinute - fromMinute);
}

/** 毎時の取込の間隔を変える（最初の分は保つ） */
export function withInterval<T extends ScheduleTiming>(timing: T, interval: number): T {
  const minutes: number[] = [];
  for (let m = timing.minutes[0] % interval; m < 60; m += interval) minutes.push(m);
  return { ...timing, hours: null, minutes };
}

export function toHourly<T extends ScheduleTiming>(timing: T): T {
  return { ...timing, hours: null, minutes: [timing.minutes[0]] };
}

export function toDaily<T extends ScheduleTiming>(timing: T, hour: number): T {
  return { ...timing, hours: [hour], minutes: [timing.minutes[0]] };
}

/**
 * ほかの取込からいちばん離れた、重なりのない時刻を探す。
 * 候補は「全体を1〜59分ずらした形」。余裕（分）が最大のもの、同点なら今の時刻に近いものを返す。
 * 重なりのない候補がなければ null。
 */
export function findRoomiestTiming(entries: TimelineEntry[], id: string): TimelineEntry | null {
  const target = entries.find((entry) => entry.id === id);
  if (!target || !target.gated || !target.editable) return null;
  const othersByDay = ALL_DAYS.map((day) => gatedEvents(entries, day, id));
  const span = isSingleTime(target) ? 30 : intervalOf(target) ?? 60;
  const deltas = isSingleTime(target)
    ? Array.from({ length: span * 2 }, (_, i) => (i % 2 === 0 ? i / 2 + 1 : -(i + 1) / 2))
    : Array.from({ length: span - 1 }, (_, i) => i + 1);

  let best: { entry: TimelineEntry; room: number; distance: number } | null = null;
  for (const delta of deltas) {
    const candidate = shiftTiming(target, delta);
    let room = Infinity;
    let clean = true;
    for (const day of ALL_DAYS) {
      for (const start of firesOn(candidate, day)) {
        const mine: RunEvent = { id, start, end: start + candidate.durationSec / 60 };
        for (const other of othersByDay[day]) {
          if (classify(mine, other) || classify(other, mine)) {
            clean = false;
            break;
          }
          room = Math.min(room, mine.start < other.start ? other.start - mine.end : mine.start - other.end);
        }
        if (!clean) break;
      }
      if (!clean) break;
    }
    if (!clean) continue;
    const distance = isSingleTime(target) ? Math.abs(delta) : Math.min(delta, span - delta);
    if (!best || room > best.room || (room === best.room && distance < best.distance)) {
      best = { entry: candidate, room, distance };
    }
  }
  return best?.entry ?? null;
}

/**
 * 重なりを自動で解消する。動かすのは毎時くり返す取込の「分」だけで、
 * 1日1回の取込（メールの到着時刻に合わせてある可能性がある）は動かさない。
 */
export function autoAdjust(entries: TimelineEntry[]): { entries: TimelineEntry[]; movedIds: string[]; remaining: number } {
  let current = entries;
  const movedIds: string[] = [];
  const allConflicts = (list: TimelineEntry[]) => ALL_DAYS.flatMap((day) => findConflicts(list, day));

  for (let pass = 0; pass < entries.length; pass += 1) {
    const conflicts = allConflicts(current);
    if (conflicts.length === 0) break;
    // 発火の少ない取込から動かす（動かす影響が小さい）
    const movable = current
      .filter((e) => e.hours === null && e.editable && !movedIds.includes(e.id) && conflicts.some((c) => involves(c, e.id)))
      .sort((a, b) => a.minutes.length - b.minutes.length);
    let moved = false;
    for (const entry of movable) {
      const next = findRoomiestTiming(current, entry.id);
      if (!next) continue;
      current = current.map((e) => (e.id === entry.id ? next : e));
      movedIds.push(entry.id);
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return { entries: current, movedIds, remaining: allConflicts(current).length };
}

export type HistoryRun = { scheduleId: string; status: string; startedAt: string; completedAt?: string | null };

/** 取込履歴から、スケジュールごとの所要時間（直近10回の最長・秒）を出す */
export function durationsFromHistory(histories: HistoryRun[]): Map<string, number> {
  const recent = new Map<string, number[]>();
  for (const run of histories) {
    if (run.status !== 'COMPLETED' || !run.completedAt) continue;
    const seconds = (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    const list = recent.get(run.scheduleId) ?? [];
    if (list.length < 10) list.push(seconds);
    recent.set(run.scheduleId, list);
  }
  const durations = new Map<string, number>();
  recent.forEach((list, id) => durations.set(id, Math.max(1, Math.ceil(Math.max(...list)))));
  return durations;
}

export const pad2 = (value: number) => String(value).padStart(2, '0');
export const formatClock = (minuteOfDay: number) => `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;

export function formatDays(days: number[]): string {
  if (days.length === 7) return '';
  const consecutive = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`;
  return days.map((d) => DAY_LABELS[d]).join('');
}

/** 一覧の行に出す短い時刻表記（例: ":12 :42"、"月–土 06:25"） */
export function formatTimingShort(timing: ScheduleTiming): string {
  const days = formatDays(timing.days);
  const prefix = days ? `${days} ` : '';
  if (timing.hours === null) {
    const interval = intervalOf(timing);
    if (timing.minutes.length > 4 && interval) return `${prefix}${interval}分ごと`;
    return prefix + timing.minutes.map((m) => `:${pad2(m)}`).join(' ');
  }
  const times = timing.hours.flatMap((h) => timing.minutes.map((m) => `${pad2(h)}:${pad2(m)}`));
  return prefix + (times.length > 3 ? `${times.slice(0, 3).join(' ')} …` : times.join(' '));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}
