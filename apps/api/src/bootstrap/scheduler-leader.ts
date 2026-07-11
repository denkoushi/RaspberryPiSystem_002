import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import {
  startPostListenSchedulers,
  stopPostListenSchedulers,
  type PostListenSchedulerHandles,
} from './start-post-listen-schedulers.js';

const enabled = process.env['PI5_SCHEDULER_LEADER_ENABLED'] === '1';
const leaseFile = process.env['PI5_SCHEDULER_LEASE_FILE'] || '/app/alerts/.pi5-scheduler-leader';
const intervalMs = Number(process.env['PI5_SCHEDULER_LEASE_INTERVAL_MS'] || 2_000);
const staleMs = Math.max(intervalMs * 3, 120_000);

export type SchedulerRuntime = {
  stop: () => Promise<void>;
};

type LeaseHandle = Awaited<ReturnType<typeof open>>;

/**
 * Start schedulers directly for the legacy path, or elect exactly one API
 * process as the scheduler owner for the Blue/Green path.
 *
 * The lease is a small file on the shared alerts mount. Exclusive creation,
 * heartbeat timestamps, and stale-owner recovery make the handoff safe when a
 * slot is stopped after the gateway switch.
 */
export async function startSchedulerRuntime(app: FastifyInstance): Promise<SchedulerRuntime> {
  if (!enabled) {
    const handles = await startPostListenSchedulers(app);
    return { stop: () => stopPostListenSchedulers(app, handles) };
  }

  const token = `${process.pid}:${Date.now()}`;
  let lease: LeaseHandle | null = null;
  let handles: PostListenSchedulerHandles | null = null;
  let stopping = false;
  let tickInFlight: Promise<void> | null = null;

  const releaseSchedulers = async () => {
    if (!handles) return;
    const current = handles;
    handles = null;
    await stopPostListenSchedulers(app, current);
    logger.info('Scheduler leader lease released');
  };

  const releaseLease = async () => {
    if (!lease) return;
    const current = lease;
    lease = null;
    try {
      await current.close();
    } finally {
      try {
        const owner = await readFile(leaseFile, 'utf8');
        if (owner === token) await unlink(leaseFile);
      } catch {
        // The owner may already have been replaced or removed.
      }
    }
  };

  const relinquish = async () => {
    await releaseSchedulers();
    await releaseLease();
  };

  const heartbeat = async () => {
    if (!lease) return false;
    try {
      const owner = await readFile(leaseFile, 'utf8');
      if (owner !== token) {
        await relinquish();
        return false;
      }
      await lease.truncate(0);
      await lease.writeFile(`${token}\n`);
      return true;
    } catch {
      await relinquish();
      return false;
    }
  };

  const tryAcquire = async () => {
    if (lease || stopping) return;
    await mkdir(dirname(leaseFile), { recursive: true });
    let candidateLease: LeaseHandle | null = null;
    try {
      candidateLease = await open(leaseFile, 'wx');
      await candidateLease.writeFile(`${token}\n`);
      await candidateLease.sync();
      lease = candidateLease;
      candidateLease = null;
      handles = await startPostListenSchedulers(app);
      logger.info({ leaseFile }, 'Scheduler leader lease acquired');
    } catch (error) {
      if (candidateLease) await candidateLease.close().catch(() => undefined);
      if (lease) await releaseLease();
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        logger.warn({ err: error, leaseFile }, 'Scheduler leader lease acquisition failed');
        return;
      }
      try {
        const details = await stat(leaseFile);
        if (Date.now() - details.mtimeMs > staleMs) await unlink(leaseFile);
      } catch {
        // The other owner may have completed a handoff between stat and unlink.
      }
    }
  };

  const tick = async () => {
    if (stopping) return;
    if (tickInFlight) return tickInFlight;
    tickInFlight = (async () => {
      if (stopping) return;
      if (lease) {
        await heartbeat();
      } else {
        await tryAcquire();
      }
    })().finally(() => {
      tickInFlight = null;
    });
    await tickInFlight;
  };

  await tick();
  // Keep the timer referenced so a contender cannot be suspended while the
  // process is waiting for a lease handoff.  The API shutdown path clears it.
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop: async () => {
      stopping = true;
      clearInterval(timer);
      if (tickInFlight) await tickInFlight;
      await relinquish();
    },
  };
}
