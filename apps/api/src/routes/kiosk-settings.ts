import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import {
  getInquiryReceiverSettings,
  replaceInquiryReceiverSettings,
  lookupInquiryReceiverEmployee
} from '../services/kiosk-inquiry/kiosk-inquiry-settings.service.js';
import {
  getKioskHeaderTabOrderSettings,
  upsertKioskHeaderTabOrderSettings
} from '../services/kiosk/kiosk-header-tab-order.service.js';

const navTabOrderBodySchema = z.object({
  tabOrder: z.array(z.string().min(1).max(64)).max(64)
});

const inquiryReceiversBodySchema = z.object({
  receiverClientDeviceIds: z.array(z.string().min(1)),
  employeeCodes: z.array(z.string().min(1))
}).strict();
const employeeLookupQuerySchema = z.object({ employeeCode: z.string().min(1) }).strict();

export function registerKioskSettingsRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/kiosk-settings/inquiry-receivers', { preHandler: canManage }, async () => {
    return { settings: await getInquiryReceiverSettings() };
  });

  app.put('/kiosk-settings/inquiry-receivers', { preHandler: canManage }, async (request) => {
    const body = inquiryReceiversBodySchema.parse(request.body);
    return { settings: await replaceInquiryReceiverSettings(body.receiverClientDeviceIds, body.employeeCodes) };
  });

  app.get('/kiosk-settings/inquiry-receivers/employee-lookup', { preHandler: canManage }, async (request) => {
    const query = employeeLookupQuerySchema.parse(request.query);
    return { employee: await lookupInquiryReceiverEmployee(query.employeeCode) };
  });

  app.get('/kiosk-settings/nav-tab-order', { preHandler: canManage }, async () => {
    const settings = await getKioskHeaderTabOrderSettings();
    return { settings };
  });

  app.put('/kiosk-settings/nav-tab-order', { preHandler: canManage }, async (request) => {
    const body = navTabOrderBodySchema.parse(request.body);
    const settings = await upsertKioskHeaderTabOrderSettings(body.tabOrder);
    return { settings };
  });
}
