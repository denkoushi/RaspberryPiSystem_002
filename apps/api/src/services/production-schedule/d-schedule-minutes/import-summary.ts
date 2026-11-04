import type { DScheduleMinutesWarning } from './parse-d-schedule-minutes.js';

/** Stored alongside registration ownership so APPLIED retries retain their original counts. */
export type DScheduleMinutesMetrics = {
  seibansRead: number;
  dateChanged: number;
  unchanged: number;
  registeredSeibans: string[];
  unregisteredSeibans: string[];
};

export type DScheduleMinutesSummary = {
  seibansRead: number;
  dateChanged: number;
  unchanged: number;
  autoRegistered: number;
  unregistered: number;
  skipped: number;
  warnings: DScheduleMinutesWarning[];
  autoRegistrationSkipped?: 'STALE_FILE';
};

export function summarizeMinutes(metrics: DScheduleMinutesMetrics | undefined, warnings: DScheduleMinutesWarning[], autoRegistrationSkipped?: 'STALE_FILE'): DScheduleMinutesSummary {
  const skippedCodes = new Set(['UNREADABLE_DATE', 'INVALID_SEIBAN', 'UNKNOWN_STAR', 'FORMULA_NO_RESULT', 'MERGED_ACROSS_BLOCKS', 'BLOCK_SHAPE', 'STALE_FILE']);
  return {
    seibansRead: metrics?.seibansRead ?? 0, dateChanged: metrics?.dateChanged ?? 0, unchanged: metrics?.unchanged ?? 0,
    autoRegistered: metrics?.registeredSeibans.length ?? 0, unregistered: metrics?.unregisteredSeibans.length ?? 0,
    skipped: new Set(warnings.filter((warning) => skippedCodes.has(warning.code)).map((warning) => JSON.stringify([warning.seiban, warning.cell]))).size,
    warnings,
    ...(autoRegistrationSkipped ? { autoRegistrationSkipped } : {}),
  };
}
