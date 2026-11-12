import { manufacturingOrderNoSchema } from '@raspi-system/shared-types';
import { z } from 'zod';

import { getHaizenOrderTrail } from '../../services/mobile-placement/order-trail.service.js';
import { requireClientDevice } from '../kiosk/shared.js';

import type { FastifyInstance } from 'fastify';

const querySchema = z.object({ order: manufacturingOrderNoSchema });

export async function registerOrderTrailRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mobile-placement/order-trail', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const { order } = querySchema.parse(request.query);
    return { trail: await getHaizenOrderTrail(order) };
  });
}
