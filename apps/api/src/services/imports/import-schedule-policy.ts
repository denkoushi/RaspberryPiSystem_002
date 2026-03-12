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

function extractMinuteField(schedule: string): string | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return parts[0] ?? null;
}

export function detectGmailScheduleMinuteCollisions(config: BackupConfig): string[] {
  const collisions = new Map<string, string[]>();
  for (const schedule of config.csvImports ?? []) {
    if (!schedule.enabled || !isGmailCsvDashboardSchedule(schedule, config.storage.provider)) {
      continue;
    }
    const minute = extractMinuteField(schedule.schedule);
    if (!minute) continue;
    const ids = collisions.get(minute) ?? [];
    ids.push(schedule.id);
    collisions.set(minute, ids);
  }
  return Array.from(collisions.entries())
    .filter(([, ids]) => ids.length >= 2)
    .map(([minute, ids]) => `Gmail csvDashboards schedules overlap at minute pattern "${minute}": ${ids.join(', ')}`);
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
