import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getKioskInquirySummary,
  listKioskInquiries,
  openKioskInquiry,
  replyToKioskInquiry
} from '../../services/kiosk-inquiry/kiosk-inquiry.service.js';
import { sendSlackNotification } from '../../services/notifications/slack-webhook.js';
import { requireClientDevice, resolveLocationScopeContext } from './shared.js';

const employeeTagSchema = z.object({ employeeTagUid: z.string().min(1).optional() }).strict();
const replySchema = employeeTagSchema.extend({ body: z.string().min(1).max(1000) }).strict();
const threadParamsSchema = z.object({ threadId: z.string().min(1) }).strict();

export async function registerKioskInquiryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/inquiries/summary', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    return getKioskInquirySummary(clientDevice);
  });

  app.post('/kiosk/inquiries/list', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = employeeTagSchema.parse(request.body === undefined ? {} : request.body);
    return listKioskInquiries(clientDevice, body.employeeTagUid);
  });

  app.post('/kiosk/inquiries/:threadId/open', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { threadId } = threadParamsSchema.parse(request.params);
    const body = employeeTagSchema.parse(request.body === undefined ? {} : request.body);
    return openKioskInquiry(clientDevice, threadId, body.employeeTagUid);
  });

  app.post('/kiosk/inquiries/:threadId/reply', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { threadId } = threadParamsSchema.parse(request.params);
    const body = replySchema.parse(request.body);
    const result = await replyToKioskInquiry(clientDevice, threadId, body.body, body.employeeTagUid);
    if (!clientDevice.inquiryReceiverEnabled) {
      sendSlackNotification({
        clientId: clientDevice.id,
        clientName: clientDevice.name,
        location: resolveLocationScopeContext(clientDevice).deviceScopeKey,
        page: result.thread.page,
        message: body.body,
        requestId: request.id
      }).catch((error) => {
        app.log.error(
          { err: error, requestId: request.id, clientId: clientDevice.id },
          '[KioskInquiry] Failed to send Slack notification'
        );
      });
    }
    return result;
  });
}
