export class SchedulerStartupCleanupError extends Error {
  readonly causeErrors: Error[];
  constructor(errors: Error[]) {
    super('Post-listen scheduler startup failed and cleanup reported errors');
    this.name = 'SchedulerStartupCleanupError';
    this.causeErrors = errors;
  }
}

/** A scheduler step may still own work after its own startup cleanup failed. */
export class SchedulerStepStateAmbiguousError extends Error {
  readonly stepName: string;
  readonly causeErrors: Error[];

  constructor(stepName: string, errors: unknown[]) {
    super(`${stepName} startup failed and its stopped state could not be proven`);
    this.name = 'SchedulerStepStateAmbiguousError';
    this.stepName = stepName;
    this.causeErrors = errors.map(errorForLog);
  }
}

export function isSchedulerStartupCleanupError(error: unknown): error is SchedulerStartupCleanupError {
  return error instanceof SchedulerStartupCleanupError;
}

export function isSchedulerStepStateAmbiguousError(
  error: unknown
): error is SchedulerStepStateAmbiguousError {
  return error instanceof SchedulerStepStateAmbiguousError;
}

export function errorForLog(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
