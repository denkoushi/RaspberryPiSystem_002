import type { FastifyInstance } from 'fastify';

import { listMobileVerifyRecords, saveMobileVerifyRecord, verifyRecordBodySchema, verifyRecordQuerySchema } from '../../services/mobile-placement/mobile-verify-record.service.js';
import { requireClientDevice } from '../kiosk/shared.js';

export async function registerMobileVerifyRecordRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mobile-placement/verify-records', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { status, record } = await saveMobileVerifyRecord(verifyRecordBodySchema.parse(request.body), clientDevice.id);
    return reply.code(status).send(record);
  });
  app.get('/mobile-placement/verify-records', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    return { records: await listMobileVerifyRecords(verifyRecordQuerySchema.parse(request.query)) };
  });
}
