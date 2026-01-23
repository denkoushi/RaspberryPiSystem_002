export const DAYS_OF_WEEK = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' }
];

export const MIN_INTERVAL_MINUTES = 5;
export const INTERVAL_PRESETS = [5, 10, 15, 30, 60];

export type ScheduleMode = 'timeOfDay' | 'intervalMinutes' | 'custom';

export type ParsedCronSchedule = {
  mode: ScheduleMode;
  time: string;
  daysOfWeek: number[];
  intervalMinutes?: number;
  isEditable: boolean;
  reason?: string;
};

function parseDaysOfWeek(dayOfWeek: string): number[] | null {
  if (dayOfWeek === '*') {
    return [];
  }

  const dayParts = dayOfWeek.split(',');
  const parsed = dayParts
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
  if (parsed.length !== dayParts.length) {
    return null;
  }

  return parsed;
}

/**
 * cron形式のスケジュールをUI形式に変換
 * cron形式: "分 時 日 月 曜日"
 */
export function parseCronSchedule(cronSchedule?: string): ParsedCronSchedule {
  if (!cronSchedule || !cronSchedule.trim()) {
    return { mode: 'timeOfDay', time: '02:00', daysOfWeek: [], isEditable: true };
  }

  const parts = cronSchedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      mode: 'custom',
      time: '02:00',
      daysOfWeek: [],
      isEditable: false,
      reason: 'cron形式が標準の5要素ではありません'
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== '*' || month !== '*') {
    return {
      mode: 'custom',
      time: '02:00',
      daysOfWeek: [],
      isEditable: false,
      reason: '日/月指定を含むcronはUI編集対象外です'
    };
  }

  const daysOfWeek = parseDaysOfWeek(dayOfWeek);
  if (!daysOfWeek) {
    return {
      mode: 'custom',
      time: '02:00',
      daysOfWeek: [],
      isEditable: false,
      reason: '曜日指定が解析できません'
    };
  }

  if (minute.startsWith('*/') && hour === '*') {
    const intervalMinutes = parseInt(minute.slice(2), 10);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
      return {
        mode: 'custom',
        time: '02:00',
        daysOfWeek: [],
        isEditable: false,
        reason: '間隔指定が解析できません'
      };
    }
    return {
      mode: 'intervalMinutes',
      time: '02:00',
      daysOfWeek,
      intervalMinutes,
      isEditable: true
    };
  }

  const hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  if (!Number.isInteger(hourNum) || !Number.isInteger(minuteNum)) {
    return {
      mode: 'custom',
      time: '02:00',
      daysOfWeek: [],
      isEditable: false,
      reason: '時刻指定が解析できません'
    };
  }

  const time = `${hourNum.toString().padStart(2, '0')}:${minuteNum.toString().padStart(2, '0')}`;
  return {
    mode: 'timeOfDay',
    time,
    daysOfWeek,
    isEditable: true
  };
}

/**
 * UI形式からcron形式のスケジュールに変換
 * UI形式: { time: "04:00", daysOfWeek: [1,3,5] }
 * cron形式: "0 4 * * 1,3,5"
 */
export function formatCronSchedule(time: string, daysOfWeek: number[]): string {
  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour || '2', 10);
  const minuteNum = parseInt(minute || '0', 10);

  const dayOfWeekStr = daysOfWeek.length === 0 ? '*' : daysOfWeek.sort((a, b) => a - b).join(',');
  return `${minuteNum} ${hourNum} * * ${dayOfWeekStr}`;
}

/**
 * UI形式（間隔）からcron形式に変換
 * intervalMinutes: 5 -> "* /5 * * * *"
 */
export function formatIntervalCronSchedule(intervalMinutes: number, daysOfWeek: number[]): string {
  const dayOfWeekStr = daysOfWeek.length === 0 ? '*' : daysOfWeek.sort((a, b) => a - b).join(',');
  return `*/${intervalMinutes} * * * ${dayOfWeekStr}`;
}

/**
 * cron形式のスケジュールを人間が読みやすい形式に変換
 */
export function formatScheduleForDisplay(cronSchedule: string): string {
  const parsed = parseCronSchedule(cronSchedule);
  const { time, daysOfWeek, mode, intervalMinutes } = parsed;

  if (mode === 'intervalMinutes' && intervalMinutes) {
    const dayLabels = daysOfWeek
      .sort((a, b) => a - b)
      .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
      .filter(Boolean)
      .join('、');
    if (daysOfWeek.length === 0) {
      return `毎日${intervalMinutes}分ごと`;
    }
    return `毎週${dayLabels}の${intervalMinutes}分ごと`;
  }

  if (mode === 'custom') {
    return `cron: ${cronSchedule}`;
  }

  const [hour, minute] = time.split(':');
  const hourNum = parseInt(hour || '0', 10);
  const minuteNum = parseInt(minute || '0', 10);

  let timeStr: string;
  if (hourNum === 0) {
    timeStr = minuteNum === 0 ? '午前0時' : `午前0時${minuteNum}分`;
  } else if (hourNum < 12) {
    timeStr = minuteNum === 0 ? `午前${hourNum}時` : `午前${hourNum}時${minuteNum}分`;
  } else if (hourNum === 12) {
    timeStr = minuteNum === 0 ? '午後12時' : `午後12時${minuteNum}分`;
  } else {
    const pmHour = hourNum - 12;
    timeStr = minuteNum === 0 ? `午後${pmHour}時` : `午後${pmHour}時${minuteNum}分`;
  }

  if (daysOfWeek.length === 0) {
    return `毎日${timeStr}`;
  }

  const dayLabels = daysOfWeek
    .sort((a, b) => a - b)
    .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
    .filter(Boolean)
    .join('、');

  return `毎週${dayLabels}の${timeStr}`;
}
