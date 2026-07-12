export class SchedulerStartupCleanupError extends Error {
  readonly causeErrors: Error[];
  constructor(errors: Error[]) {
    super('Post-listen scheduler startup failed and cleanup reported errors');
    this.name = 'SchedulerStartupCleanupError';
    this.causeErrors = errors;
  }
}

export function isSchedulerStartupCleanupError(error: unknown): error is SchedulerStartupCleanupError {
  return error instanceof SchedulerStartupCleanupError;
}

export function errorForLog(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
