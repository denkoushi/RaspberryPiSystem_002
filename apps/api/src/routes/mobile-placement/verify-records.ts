import type { FastifyInstance } from 'fastify';

import { listMobileVerifyRecords, saveMobileVerifyRecord, verifyRecordBodySchema, verifyRecordQuerySchema } from '../../services/mobile-placement/mobile-verify-record.service.js';
import { requireClientDevice } from '../kiosk/shared.js';

const UPLOAD_RATE_LIMIT = { max: 600, timeWindow: '1 minute' };
const READ_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };

export async function registerMobileVerifyRecordRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mobile-placement/verify-records', { config: { rateLimit: UPLOAD_RATE_LIMIT } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { status, record } = await saveMobileVerifyRecord(verifyRecordBodySchema.parse(request.body), clientDevice.id);
    return reply.code(status).send(record);
  });
  app.get('/mobile-placement/verify-records', { config: { rateLimit: READ_RATE_LIMIT } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return { records: await listMobileVerifyRecords(verifyRecordQuerySchema.parse(request.query)) };
  });
}
