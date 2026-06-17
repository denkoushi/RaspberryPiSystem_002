import type { BackupConfig, CsvImportTarget } from '../backup/backup-config.js';

export const MIN_CSV_IMPORT_INTERVAL_MINUTES = 5;

function hasCsvDashboardTarget(schedule: { targets?: CsvImportTarget[] }): boolean {
  return Array.isArray(schedule.targets) && schedule.targets.some((target) => target.type === 'csvDashboards');
}

function isGmailCsvDashboardSchedule(
  schedule: { provider?: 'dropbox' | 'gmail'; targets?: CsvImportTarget[] },
  fallbackProvider: 'local' | 'dropbox' | 'gmail'
): boolean {
  const provider = schedule.provider ?? fallbackProvider;
  return provider === 'gmail' && hasCsvDashboardTarget(schedule);
}

function expandCronPart(part: string, min: number, max: number): Set<number> | null {
  const steppedRangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (steppedRangeMatch) {
    const start = Number.parseInt(steppedRangeMatch[1] ?? '', 10);
    const end = Number.parseInt(steppedRangeMatch[2] ?? '', 10);
    const step = steppedRangeMatch[3] ? Number.parseInt(steppedRangeMatch[3], 10) : 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(step) || step <= 0) {
      return null;
    }
    if (start < min || end > max || start > end) {
      return null;
    }
    const values = new Set<number>();
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
    return values;
  }

  const value = Number.parseInt(part, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return new Set([value]);
}

function expandCronField(field: string, min: number, max: number): Set<number> | null {
  if (field === '*') {
    return new Set(Array.from({ length: max - min + 1 }, (_, index) => min + index));
  }

  if (field.startsWith('*/')) {
    const step = Number.parseInt(field.slice(2), 10);
    if (!Number.isInteger(step) || step <= 0) {
      return null;
    }
    const values = new Set<number>();
    for (let value = min; value <= max; value += step) {
      values.add(value);
    }
    return values;
  }

  const values = new Set<number>();
  for (const part of field.split(',')) {
    const expanded = expandCronPart(part.trim(), min, max);
    if (!expanded) {
      return null;
    }
    for (const value of expanded) {
      values.add(value);
    }
  }
  return values;
}

/** minute/hour/dayOfWeek の交差判定用。dayOfMonth/month は `*` のみ対応。 */
export function expandGmailScheduleTriggerKeys(cron: string): Set<string> | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  if (dayOfMonthField !== '*' || monthField !== '*') {
    return null;
  }

  const minutes = expandCronField(minuteField ?? '', 0, 59);
  const hours = expandCronField(hourField ?? '', 0, 23);
  const daysOfWeek = expandCronField(dayOfWeekField ?? '', 0, 6);
  if (!minutes || !hours || !daysOfWeek) {
    return null;
  }

  const triggers = new Set<string>();
  for (const minute of minutes) {
    for (const hour of hours) {
      for (const dayOfWeek of daysOfWeek) {
        triggers.add(`${minute}:${hour}:${dayOfWeek}`);
      }
    }
  }
  return triggers;
}

function formatTriggerSample(triggerKey: string): string {
  const [minute, hour, dayOfWeek] = triggerKey.split(':');
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

export function detectGmailScheduleMinuteCollisions(config: BackupConfig): string[] {
  const warnings: string[] = [];
  const activeSchedules = (config.csvImports ?? []).filter(
    (schedule) => schedule.enabled && isGmailCsvDashboardSchedule(schedule, config.storage.provider)
  );

  const triggersByScheduleId = new Map<string, Set<string>>();
  const indeterminateScheduleIds: string[] = [];

  for (const schedule of activeSchedules) {
    const triggers = expandGmailScheduleTriggerKeys(schedule.schedule);
    if (!triggers) {
      indeterminateScheduleIds.push(schedule.id);
      continue;
    }
    triggersByScheduleId.set(schedule.id, triggers);
  }

  for (const scheduleId of indeterminateScheduleIds) {
    warnings.push(
      `Gmail csvDashboards schedule "${scheduleId}" uses a cron shape that cannot be checked for collisions (dayOfMonth/month must be * for detection)`
    );
  }

  const scheduleIds = Array.from(triggersByScheduleId.keys());
  for (let i = 0; i < scheduleIds.length; i += 1) {
    for (let j = i + 1; j < scheduleIds.length; j += 1) {
      const scheduleIdA = scheduleIds[i]!;
      const scheduleIdB = scheduleIds[j]!;
      const triggersA = triggersByScheduleId.get(scheduleIdA)!;
      const triggersB = triggersByScheduleId.get(scheduleIdB)!;
      const overlap = [...triggersA].filter((trigger) => triggersB.has(trigger));
      if (overlap.length === 0) {
        continue;
      }
      const sample = overlap.slice(0, 3).map(formatTriggerSample).join(', ');
      warnings.push(
        `Gmail csvDashboards schedules may run at the same time (${sample}): ${scheduleIdA}, ${scheduleIdB}`
      );
    }
  }

  return warnings;
}

export function extractIntervalMinutes(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minute, hour, dayOfMonth, month] = parts;
  if (hour !== '*' || dayOfMonth !== '*' || month !== '*') {
    return null;
  }
  if (minute === '*') {
    return 1;
  }
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2), 10);
    return Number.isInteger(interval) ? interval : null;
  }
  return null;
}
