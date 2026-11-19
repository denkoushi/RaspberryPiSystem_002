import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ProcedureManualMailService } from '../../services/assembly/procedure-manual-mail.service.js';
import { requireClientDevice } from '../kiosk/shared.js';

const sendSchema = z.strictObject({
  documentId: z.string().guid(),
  revisionId: z.string().guid(),
  nfcUid: z.string().trim().min(1).max(128),
  localPart: z.string(),
});

export function registerProcedureManualMailRoute(
  app: FastifyInstance,
  service = new ProcedureManualMailService(),
) {
  app.post('/assembly/procedure-manuals/mail', async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    return service.send(sendSchema.parse(request.body), clientDevice);
  });
}
