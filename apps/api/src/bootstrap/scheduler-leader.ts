import { Client } from 'pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  errorForLog,
  isSchedulerStartupCleanupError,
} from './scheduler-errors.js';
import {
  createSchedulerRuntimeState,
  type SchedulerRuntimeSnapshot,
  type SchedulerRuntimeState,
} from './scheduler-runtime-state.js';
import {
  startPostListenSchedulers,
  stopPostListenSchedulers,
} from './start-post-listen-schedulers.js';

/**
 * PostgreSQL session advisory-lock key pair (two int4 values).
 *
 * These constants identify the single Pi5 Blue/Green scheduler-owner lock.
 * They must stay stable across releases so Blue and Green slots contend on the
 * same lock. They are intentionally outside Prisma's connection pool: the lock
 * is owned by one dedicated `pg` Client session for the process lifetime.
 */
export const SCHEDULER_ADVISORY_LOCK_KEY1 = 0x50335f53; // 'P3_S'
export const SCHEDULER_ADVISORY_LOCK_KEY2 = 0x43484544; // 'CHED' (scheduler)

const TRY_LOCK_SQL = 'SELECT pg_try_advisory_lock($1, $2) AS acquired';
const UNLOCK_SQL = 'SELECT pg_advisory_unlock($1, $2) AS released';
const PROBE_LOCK_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND classid = $1::int4
      AND objid = $2::int4
      AND pid = pg_backend_pid()
      AND granted
  ) AS held
`;

export type AdvisoryLockClient = {
  connect: () => Promise<void>;
  query: (
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
  on: (event: 'error' | 'end', listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: 'error' | 'end', listener: (...args: unknown[]) => void) => unknown;
};

export type SchedulerRuntime = {
  stop: () => Promise<void>;
  getStatus: () => SchedulerRuntimeSnapshot;
};

export type StartSchedulerRuntimeOptions = {
  enabled?: boolean;
  databaseUrl?: string;
  state?: SchedulerRuntimeState;
  clientFactory?: (databaseUrl: string) => AdvisoryLockClient;
  startSchedulers?: (app: FastifyInstance) => Promise<unknown>;
  stopSchedulers?: (app: FastifyInstance, handles: unknown) => Promise<void>;
  retryInitialMs?: number;
  retryMaxMs?: number;
  standbyRetryMs?: number;
  probeIntervalMs?: number;
  fatalShutdown?: (error: Error) => void | Promise<void>;
};

type AppWithSchedulerState = FastifyInstance & {
  schedulerRuntimeState?: SchedulerRuntimeState;
};

function readLeaderEnabled(): boolean {
  return process.env['PI5_SCHEDULER_LEADER_ENABLED'] === '1';
}

function defaultClientFactory(databaseUrl: string): AdvisoryLockClient {
  return new Client({ connectionString: databaseUrl }) as unknown as AdvisoryLockClient;
}

function productionFatalSchedulerShutdown(error: Error): never {
  void error;
  process.exit(1);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

/**
 * Elect at most one API process as scheduler owner via a dedicated PostgreSQL
 * session advisory lock. Legacy mode (enabled=false) starts schedulers directly.
 */
export async function startSchedulerRuntime(
  app: FastifyInstance,
  options: StartSchedulerRuntimeOptions = {}
): Promise<SchedulerRuntime> {
  const enabled = options.enabled ?? readLeaderEnabled();
  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;
  const state =
    options.state ??
    (app as AppWithSchedulerState).schedulerRuntimeState ??
    createSchedulerRuntimeState();
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const startSchedulers =
    options.startSchedulers ?? ((instance) => startPostListenSchedulers(instance));
  const stopSchedulers =
    options.stopSchedulers ??
    ((instance, handles) =>
      stopPostListenSchedulers(instance, handles as Awaited<ReturnType<typeof startPostListenSchedulers>>));
  const retryInitialMs = options.retryInitialMs ?? 1_000;
  const retryMaxMs = options.retryMaxMs ?? 30_000;
  const standbyRetryMs = options.standbyRetryMs ?? 2_000;
  const probeIntervalMs = options.probeIntervalMs ?? 2_000;
  const fatalShutdown = options.fatalShutdown ?? productionFatalSchedulerShutdown;

  if (!enabled) {
    state.setLeader({ enabled: false, databaseConnection: 'not-used' });
    const handles = await startSchedulers(app);
    return {
      getStatus: () => state.snapshot(),
      stop: async () => {
        await stopSchedulers(app, handles);
        state.setStopped({ enabled: false, databaseConnection: 'not-used' });
      },
    };
  }

  let stopping = false;
  let failedClosed = false;
  let consecutiveFailures = 0;
  let currentClient: AdvisoryLockClient | null = null;
  let holdingLock = false;
  let handles: unknown | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let probeTimer: NodeJS.Timeout | null = null;
  let attemptInFlight: Promise<void> | null = null;
  let fatalShutdownPromise: Promise<void> | null = null;

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const clearProbeTimer = () => {
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
  };

  const retryDelayAfterFailure = () =>
    Math.min(retryMaxMs, retryInitialMs * 2 ** Math.max(0, consecutiveFailures - 1));

  const detachClientListeners = (client: AdvisoryLockClient) => {
    if (!client.removeListener) return;
    client.removeListener('error', onClientError);
    client.removeListener('end', onClientEnd);
  };

  const disconnectCurrentClient = async (unlock: boolean): Promise<void> => {
    const client = currentClient;
    currentClient = null;
    holdingLock = false;
    clearProbeTimer();
    if (!client) return;
    detachClientListeners(client);
    if (unlock) {
      try {
        await client.query(UNLOCK_SQL, [SCHEDULER_ADVISORY_LOCK_KEY1, SCHEDULER_ADVISORY_LOCK_KEY2]);
      } catch (error) {
        logger.warn({ err: errorForLog(error) }, 'Failed to release scheduler advisory lock');
      }
    }
    try {
      await client.end();
    } catch (error) {
      logger.warn({ err: errorForLog(error) }, 'Failed to close scheduler advisory-lock client');
    }
  };

  const stopActiveSchedulers = async (phase: string): Promise<boolean> => {
    if (!handles) return true;
    const current = handles;
    handles = null;
    try {
      await stopSchedulers(app, current);
      logger.info({ phase }, 'Post-listen scheduler group stopped');
      return true;
    } catch (error) {
      state.recordError(error);
      logger.error(
        { err: errorForLog(error), phase },
        'Failed to prove post-listen scheduler group stopped'
      );
      return false;
    }
  };

  const failClosed = async (reason: unknown, phase: string): Promise<void> => {
    if (fatalShutdownPromise) return fatalShutdownPromise;
    // Keep the advisory lock held when stop is ambiguous so a peer cannot start
    // schedulers while this process may still be running background work.
    failedClosed = true;
    stopping = true;
    clearRetryTimer();
    clearProbeTimer();
    const error = errorForLog(reason);
    state.recordError(error);
    state.setStopped({ enabled: true, databaseConnection: 'disconnected' });
    logger.fatal({ err: error, phase }, 'Scheduler runtime failed closed');
    fatalShutdownPromise = (async () => {
      try {
        await fatalShutdown(error);
      } catch (shutdownError) {
        logger.error(
          { err: errorForLog(shutdownError), phase },
          'Scheduler fatalShutdown hook failed'
        );
      }
    })();
    return fatalShutdownPromise;
  };

  const handleConnectionOrLockLoss = async (reason: unknown): Promise<void> => {
    if (stopping || failedClosed) return;
    clearProbeTimer();
    state.recordError(reason);
    // Demote readiness immediately so Blue/Green never treats a demoting
    // process as a connected leader/standby while stop is still in flight.
    state.setStandby({ databaseConnection: 'disconnected' });
    logger.warn(
      { err: errorForLog(reason) },
      'Scheduler leader lost its PostgreSQL session or advisory lock'
    );
    const stoppedCleanly = await stopActiveSchedulers('database-session-or-lock-lost');
    if (!stoppedCleanly) {
      await failClosed(
        new Error('Cannot prove all background schedulers stopped after database session or lock loss'),
        'database-session-or-lock-loss'
      );
      return;
    }
    await disconnectCurrentClient(false);
    consecutiveFailures += 1;
    state.setStandby({ databaseConnection: 'disconnected' });
    scheduleAttempt(retryDelayAfterFailure());
  };

  function onClientError(...args: unknown[]) {
    const reason = args[0] ?? new Error('Scheduler advisory-lock client error');
    void handleConnectionOrLockLoss(reason);
  }

  function onClientEnd() {
    void handleConnectionOrLockLoss(new Error('Scheduler advisory-lock client ended unexpectedly'));
  }

  const startProbe = () => {
    clearProbeTimer();
    probeTimer = setInterval(() => {
      void (async () => {
        if (stopping || failedClosed || !currentClient || !holdingLock) return;
        try {
          const result = await currentClient.query(PROBE_LOCK_SQL, [
            SCHEDULER_ADVISORY_LOCK_KEY1,
            SCHEDULER_ADVISORY_LOCK_KEY2,
          ]);
          const held = asBoolean(result.rows[0]?.['held']);
          if (!held) {
            await handleConnectionOrLockLoss(
              new Error('Advisory lock is no longer held by this session')
            );
          }
        } catch (error) {
          await handleConnectionOrLockLoss(error);
        }
      })();
    }, probeIntervalMs);
    // Keep the timer referenced so standby/leader probing is not suspended.
    probeTimer.unref?.();
  };

  const scheduleAttempt = (delayMs: number) => {
    if (stopping || failedClosed) return;
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runAttempt();
    }, delayMs);
    retryTimer.unref?.();
  };

  const runAttempt = async (): Promise<void> => {
    if (stopping || failedClosed) return;
    if (attemptInFlight) return attemptInFlight;
    attemptInFlight = (async () => {
      if (stopping || failedClosed) return;

      let client = currentClient;
      try {
        if (!client) {
          client = clientFactory(databaseUrl);
          currentClient = client;
          client.on('error', onClientError);
          client.on('end', onClientEnd);
          await client.connect();
        }

        const lockResult = await client.query(TRY_LOCK_SQL, [
          SCHEDULER_ADVISORY_LOCK_KEY1,
          SCHEDULER_ADVISORY_LOCK_KEY2,
        ]);
        const acquired = asBoolean(lockResult.rows[0]?.['acquired']);

        if (!acquired) {
          // Keep the dedicated session alive while standby.  Readiness reports
          // this connection, and its error/end events must demote the standby
          // immediately instead of leaving a stale "connected" status.
          state.setStandby({ databaseConnection: 'connected' });
          consecutiveFailures = 0;
          scheduleAttempt(standbyRetryMs);
          return;
        }

        holdingLock = true;
        consecutiveFailures = 0;
        logger.info(
          {
            key1: SCHEDULER_ADVISORY_LOCK_KEY1,
            key2: SCHEDULER_ADVISORY_LOCK_KEY2,
          },
          'Scheduler advisory lock acquired'
        );

        if (stopping) {
          await disconnectCurrentClient(true);
          return;
        }

        try {
          handles = await startSchedulers(app);
        } catch (error) {
          if (isSchedulerStartupCleanupError(error)) {
            await failClosed(error, 'scheduler-startup-cleanup-ambiguous');
            return;
          }
          state.recordError(error);
          logger.warn(
            { err: errorForLog(error) },
            'Scheduler group failed to start after advisory lock acquisition'
          );
          await disconnectCurrentClient(true);
          consecutiveFailures += 1;
          state.setStandby({ databaseConnection: 'disconnected' });
          scheduleAttempt(retryDelayAfterFailure());
          return;
        }

        if (stopping) {
          const stoppedCleanly = await stopActiveSchedulers('start-cancelled');
          if (!stoppedCleanly) {
            await failClosed(
              new Error('Cannot prove all background schedulers stopped after cancelled start'),
              'start-cancelled'
            );
            return;
          }
          await disconnectCurrentClient(true);
          return;
        }

        state.setLeader({ enabled: true, databaseConnection: 'connected' });
        startProbe();
      } catch (error) {
        state.recordError(error);
        logger.warn(
          { err: errorForLog(error) },
          'Scheduler advisory-lock acquisition attempt failed'
        );
        await disconnectCurrentClient(false);
        consecutiveFailures += 1;
        state.setStandby({ databaseConnection: 'disconnected' });
        scheduleAttempt(retryDelayAfterFailure());
      }
    })().finally(() => {
      attemptInFlight = null;
    });
    return attemptInFlight;
  };

  await runAttempt();

  return {
    getStatus: () => state.snapshot(),
    stop: async () => {
      if (failedClosed) return;
      stopping = true;
      clearRetryTimer();
      clearProbeTimer();
      if (attemptInFlight) await attemptInFlight;
      const stoppedCleanly = await stopActiveSchedulers('runtime-stop');
      if (!stoppedCleanly) {
        await failClosed(
          new Error('Cannot prove all background schedulers stopped during runtime shutdown'),
          'runtime-stop'
        );
        return;
      }
      await disconnectCurrentClient(true);
      state.setStopped({ enabled: true, databaseConnection: 'disconnected' });
    },
  };
}
