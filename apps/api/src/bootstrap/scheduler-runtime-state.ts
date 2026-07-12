import { errorForLog } from './scheduler-errors.js';

export type SchedulerRole = 'leader' | 'standby' | 'stopped';
export type SchedulerDatabaseConnection = 'connected' | 'disconnected' | 'not-used';

export type SchedulerRuntimeSnapshot = {
  enabled: boolean;
  role: SchedulerRole;
  databaseConnection: SchedulerDatabaseConnection;
  lastTransitionAt?: string;
  errors: {
    last60Seconds: number;
    total: number;
  };
};

export type SchedulerRuntimeState = {
  snapshot: () => SchedulerRuntimeSnapshot;
  setLeader: (input: {
    enabled: boolean;
    databaseConnection: 'connected' | 'not-used';
  }) => void;
  setStandby: (input?: { databaseConnection?: 'connected' | 'disconnected' }) => void;
  setStopped: (input?: {
    enabled?: boolean;
    databaseConnection?: 'disconnected' | 'not-used';
  }) => void;
  recordError: (error: unknown) => void;
  getLastError: () => Error | undefined;
};

const ERROR_WINDOW_MS = 60_000;

export function createSchedulerRuntimeState(): SchedulerRuntimeState {
  let enabled = false;
  let role: SchedulerRole = 'stopped';
  let databaseConnection: SchedulerDatabaseConnection = 'not-used';
  let lastTransitionAt: string | undefined;
  let lastError: Error | undefined;
  let totalErrors = 0;
  const errorTimestamps: number[] = [];

  const markTransition = () => {
    lastTransitionAt = new Date().toISOString();
  };

  const pruneErrorTimestamps = (now: number) => {
    const cutoff = now - ERROR_WINDOW_MS;
    while (errorTimestamps.length > 0 && errorTimestamps[0]! < cutoff) {
      errorTimestamps.shift();
    }
  };

  return {
    snapshot() {
      const now = Date.now();
      pruneErrorTimestamps(now);
      return {
        enabled,
        role,
        databaseConnection,
        ...(lastTransitionAt ? { lastTransitionAt } : {}),
        errors: {
          last60Seconds: errorTimestamps.length,
          total: totalErrors,
        },
      };
    },

    setLeader({ enabled: nextEnabled, databaseConnection: nextConnection }) {
      enabled = nextEnabled;
      role = 'leader';
      databaseConnection = nextConnection;
      markTransition();
    },

    setStandby(input = {}) {
      enabled = true;
      role = 'standby';
      databaseConnection = input.databaseConnection ?? 'connected';
      markTransition();
    },

    setStopped(input = {}) {
      if (input.enabled !== undefined) enabled = input.enabled;
      role = 'stopped';
      databaseConnection = input.databaseConnection ?? 'disconnected';
      markTransition();
    },

    recordError(error) {
      lastError = errorForLog(error);
      totalErrors += 1;
      const now = Date.now();
      errorTimestamps.push(now);
      pruneErrorTimestamps(now);
    },

    getLastError() {
      return lastError;
    },
  };
}
