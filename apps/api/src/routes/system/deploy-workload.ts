import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';

const requestSchema = z.object({
  action: z.enum(['pause-signage', 'resume-signage']),
});

function isInternalAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || Boolean(address?.startsWith('172.'));
}

function tokenMatches(provided: string | undefined): boolean {
  const expected = env.DEPLOY_CONTROL_TOKEN ?? env.JWT_ACCESS_SECRET;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Host-local deployment control. This is intentionally not a user-facing API:
 * callers must be on loopback/Docker and possess a protected host token.
 */
export function registerDeployWorkloadRoute(app: FastifyInstance): void {
  app.post('/system/deploy-workload/internal', {
    config: { rateLimit: false },
  }, async (request, reply) => {
    const remoteAddress = request.socket.remoteAddress || request.ip;
    if (!isInternalAddress(remoteAddress)) {
      throw new ApiError(403, 'Deploy workload control is only accessible from the host runtime');
    }
    const supplied = request.headers['x-deploy-control-token'];
    const token = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!tokenMatches(token)) {
      throw new ApiError(403, 'Deploy workload control token is invalid');
    }

    const { action } = requestSchema.parse(request.body ?? {});
    if (action === 'pause-signage') {
      app.signageRenderScheduler.stop();
    } else if (!env.SIGNAGE_RENDER_ENABLED) {
      throw new ApiError(409, 'Signage rendering is disabled for this runtime');
    } else {
      app.signageRenderScheduler.start();
    }

    return reply.status(200).send({
      action,
      signage: app.signageRenderScheduler.getTelemetrySnapshot(),
    });
  });
}
