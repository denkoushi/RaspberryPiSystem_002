import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';

const requestSchema = z.object({
  action: z.enum(['pause-signage', 'resume-signage']),
});

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === '::1') return true;
  const ipv4 = address?.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return Boolean(ipv4 && /^127(?:\.[0-9]{1,3}){3}$/.test(ipv4));
}

function tokenMatches(provided: string | undefined): boolean {
  const expected = env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET;
  if (!provided) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function requireSchedulerLeader(app: FastifyInstance, expectedGeneration?: number): number {
  const scheduler = app.schedulerRuntimeState.snapshot();
  const connectedLeader = scheduler.role === 'leader'
    && (!scheduler.enabled || scheduler.databaseConnection === 'connected');
  if (!connectedLeader) {
    throw new ApiError(409, 'Deploy workload control requires the scheduler leader');
  }
  if (
    expectedGeneration !== undefined
    && scheduler.transitionGeneration !== expectedGeneration
  ) {
    throw new ApiError(409, 'Scheduler leadership changed during deploy workload control');
  }
  return scheduler.transitionGeneration;
}

/** Host-local control used only to quiesce the expensive signage renderer. */
export function registerDeployWorkloadRoute(app: FastifyInstance): void {
  let operationTail: Promise<void> = Promise.resolve();
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  app.post('/system/deploy-workload/internal', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const remoteAddress = request.socket.remoteAddress || request.ip;
    if (!isLoopbackAddress(remoteAddress)) {
      throw new ApiError(403, 'Deploy workload control is only accessible from the host runtime');
    }
    const supplied = request.headers['x-deploy-control-token'];
    const token = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!tokenMatches(token)) {
      throw new ApiError(403, 'Deploy workload control token is invalid');
    }

    const { action } = requestSchema.parse(request.body ?? {});
    return runExclusive(async () => {
      const leaderGeneration = requireSchedulerLeader(app);
      let signage: ReturnType<typeof app.signageRenderScheduler.getTelemetrySnapshot>;

      if (action === 'pause-signage') {
        await app.signageRenderScheduler.pauseForDeploy();
        requireSchedulerLeader(app, leaderGeneration);
        signage = app.signageRenderScheduler.getTelemetrySnapshot();
        if (signage.isRunning) {
          throw new ApiError(503, 'Signage rendering did not become quiescent');
        }
        requireSchedulerLeader(app, leaderGeneration);
      } else if (!env.SIGNAGE_RENDER_ENABLED) {
        throw new ApiError(409, 'Signage rendering is disabled for this runtime');
      } else {
        try {
          await app.signageRenderScheduler.resumeAfterDeploy();
          requireSchedulerLeader(app, leaderGeneration);
          signage = app.signageRenderScheduler.getTelemetrySnapshot();
          if (!signage.isRunning) {
            throw new ApiError(503, 'Signage rendering did not become active');
          }
          requireSchedulerLeader(app, leaderGeneration);
        } catch (error) {
          try {
            await app.signageRenderScheduler.pauseForDeploy();
          } catch (cleanupError) {
            request.log.error(
              { err: error, cleanupError },
              'Failed to resume signage rendering and could not prove it stopped'
            );
            throw new ApiError(503, 'Signage rendering state is ambiguous after resume failure');
          }
          if (error instanceof ApiError) throw error;
          request.log.error({ err: error }, 'Failed to resume signage rendering for deploy workload control');
          throw new ApiError(503, 'Signage rendering could not be resumed');
        }
      }

      return reply.status(200).send({
        action,
        enabled: env.SIGNAGE_RENDER_ENABLED,
        resumeRequired: action === 'pause-signage' && env.SIGNAGE_RENDER_ENABLED,
        signage,
      });
    });
  });
}
