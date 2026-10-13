import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../../lib/auth.js';
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

async function resolveLoginUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.headers.authorization) return undefined;
  const statusCode = reply.statusCode;
  try {
    await authenticate(request, reply);
    return request.user;
  } catch {
    reply.code(statusCode);
    return undefined;
  }
}

export async function registerKioskInquiryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kiosk/inquiries/summary', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    return getKioskInquirySummary(clientDevice, await resolveLoginUser(request, reply));
  });

  app.post('/kiosk/inquiries/list', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = employeeTagSchema.parse(request.body === undefined ? {} : request.body);
    const loginUser = body.employeeTagUid ? undefined : await resolveLoginUser(request, reply);
    return listKioskInquiries(clientDevice, body.employeeTagUid, loginUser);
  });

  app.post('/kiosk/inquiries/:threadId/open', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { threadId } = threadParamsSchema.parse(request.params);
    const body = employeeTagSchema.parse(request.body === undefined ? {} : request.body);
    const loginUser = body.employeeTagUid ? undefined : await resolveLoginUser(request, reply);
    return openKioskInquiry(clientDevice, threadId, body.employeeTagUid, loginUser);
  });

  app.post('/kiosk/inquiries/:threadId/reply', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const { threadId } = threadParamsSchema.parse(request.params);
    const body = replySchema.parse(request.body);
    const loginUser = body.employeeTagUid ? undefined : await resolveLoginUser(request, reply);
    const result = await replyToKioskInquiry(clientDevice, threadId, body.body, body.employeeTagUid, loginUser);
    if (result.thread.kind === 'INQUIRY' && !result.thread.isReceiver) {
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
