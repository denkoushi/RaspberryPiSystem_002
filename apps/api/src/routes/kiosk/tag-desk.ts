import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import pkg from '@prisma/client';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { createKioskSettingsPinGuard } from '../../lib/kiosk-settings-pin.js';
import { MeasuringInstrumentService } from '../../services/measuring-instruments/index.js';
import { RiggingGearService } from '../../services/rigging/index.js';
import { TAG_DESK_KINDS, TagDeskService } from '../../services/tag-desk/tag-desk.service.js';
import { EmployeeService } from '../../services/tools/employee.service.js';
import { ItemService } from '../../services/tools/item.service.js';
import { LoanService } from '../../services/tools/loan.service.js';
import { baseItemSchema } from '../tools/items/schemas.js';
import { instrumentBaseSchema } from '../measuring-instruments/schemas.js';
import { riggingGearBaseSchema } from '../rigging/schemas.js';

const { EmployeeStatus } = pkg;

/*
 * Kiosk "タグ管理" desk. Tags and the master records they belong to (employees, tools,
 * measuring instruments, rigging gear) are edited here instead of the admin console.
 * Every route needs the terminal's client key and the shared 4-digit operation password.
 * Tags are only attached or released through /bindings; the master forms never carry a UID.
 */

const pinRateLimit = { max: 10, timeWindow: '1 minute' };
const idParams = z.object({ id: z.string().uuid() });
const kindQuery = z.object({ kind: z.enum(TAG_DESK_KINDS) });
const uidParams = z.object({ uid: z.string().trim().min(1).max(256) });
const eventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) });
const linkBody = z.object({
  kind: z.enum(TAG_DESK_KINDS),
  targetId: z.string().uuid(),
  uid: z.string().trim().min(4).max(256),
  replace: z.boolean().optional()
});
const unlinkBody = z.object({
  kind: z.enum([...TAG_DESK_KINDS, 'inventory']),
  bindingId: z.string().uuid()
});

const optionalText = z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null));
const employeeCreateBody = z.object({
  employeeCode: z.string().regex(/^\d{4}$/, '社員コードは数字4桁です（例: 0001）'),
  lastName: z.string().trim().min(1, '苗字は必須です'),
  firstName: z.string().trim().min(1, '名前は必須です'),
  department: optionalText,
  section: optionalText,
  status: z.nativeEnum(EmployeeStatus).optional()
});
const employeeUpdateBody = employeeCreateBody.partial();
const itemCreateBody = baseItemSchema.omit({ nfcTagUid: true });
const itemUpdateBody = itemCreateBody.partial();
const instrumentCreateBody = instrumentBaseSchema.omit({ rfidTagUid: true });
const instrumentUpdateBody = instrumentCreateBody.partial();
const riggingCreateBody = riggingGearBaseSchema.omit({ rfidTagUid: true });
const riggingUpdateBody = riggingCreateBody.partial();

function notFoundAs(message: string) {
  return (error: unknown): never => {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') throw new ApiError(404, message);
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, '同じコード・管理番号がすでに登録されています', undefined, 'DUPLICATE_CODE');
    }
    throw error;
  };
}

export async function registerKioskTagDeskRoutes(app: FastifyInstance): Promise<void> {
  const pin = createKioskSettingsPinGuard({
    deniedMessage: 'タグ管理の操作パスワードが違います',
    deniedCode: 'TAG_DESK_ACCESS_DENIED',
    rateLimitedCode: 'TAG_DESK_ACCESS_RATE_LIMITED'
  });
  const desk = new TagDeskService();
  const employees = new EmployeeService();
  const items = new ItemService();
  const instruments = new MeasuringInstrumentService();
  const rigging = new RiggingGearService();
  const loans = new LoanService();

  const withPin = { preHandler: async (request: FastifyRequest) => { await pin.authorize(request); } };
  const clientDeviceId = async (request: FastifyRequest) => (await pin.authorize(request)).clientDeviceId;

  app.post('/kiosk/tag-desk/verify-access-password', { config: { rateLimit: pinRateLimit } }, async (request) => {
    const body = z.object({ password: z.string().max(16) }).parse(request.body ?? {});
    return pin.verify(request, body.password);
  });

  app.get('/kiosk/tag-desk/registry', { ...withPin, config: { rateLimit: false } }, async (request) => {
    const { kind } = kindQuery.parse(request.query ?? {});
    return { rows: await desk.listRegistry(kind) };
  });

  app.get('/kiosk/tag-desk/options', withPin, async () => desk.listOptions());

  app.get('/kiosk/tag-desk/tags/:uid', { ...withPin, config: { rateLimit: false } }, async (request) => {
    const { uid } = uidParams.parse(request.params);
    return { uid, bindings: await desk.resolve(uid) };
  });

  app.get('/kiosk/tag-desk/events', withPin, async (request) => {
    const { limit } = eventsQuery.parse(request.query ?? {});
    return { events: await desk.listEvents(limit) };
  });

  app.post('/kiosk/tag-desk/bindings', async (request) => {
    const actor = await clientDeviceId(request);
    const body = linkBody.parse(request.body ?? {});
    return { uid: body.uid, bindings: await desk.link({ ...body, clientDeviceId: actor }) };
  });

  app.delete('/kiosk/tag-desk/bindings', async (request) => {
    const actor = await clientDeviceId(request);
    const body = unlinkBody.parse(request.body ?? {});
    await desk.unlink({ ...body, clientDeviceId: actor });
    return { ok: true };
  });

  // --- Master records moved from the admin console -------------------------------------

  app.post('/kiosk/tag-desk/employees', withPin, async (request) => {
    const body = employeeCreateBody.parse(request.body ?? {});
    return { employee: await employees.create(body).catch(notFoundAs('社員が見つかりません')) };
  });
  app.put('/kiosk/tag-desk/employees/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = employeeUpdateBody.parse(request.body ?? {});
    return { employee: await employees.update(id, body).catch(notFoundAs('社員が見つかりません')) };
  });
  app.delete('/kiosk/tag-desk/employees/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const active = await loans.countActiveLoansForEmployee(id);
    if (active > 0) throw new ApiError(400, `未返却の持出が${active}件あるため削除できません。先に返却してください`, undefined, 'ACTIVE_LOANS');
    return { employee: await employees.delete(id).catch(notFoundAs('社員が見つかりません')) };
  });

  app.post('/kiosk/tag-desk/items', withPin, async (request) => {
    const body = itemCreateBody.parse(request.body ?? {});
    return { item: await items.create(body).catch(notFoundAs('工具が見つかりません')) };
  });
  app.put('/kiosk/tag-desk/items/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = itemUpdateBody.parse(request.body ?? {});
    return { item: await items.update(id, body).catch(notFoundAs('工具が見つかりません')) };
  });
  app.delete('/kiosk/tag-desk/items/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const active = await loans.countActiveLoansForItem(id);
    if (active > 0) throw new ApiError(400, `未返却の持出が${active}件あるため削除できません。先に返却してください`, undefined, 'ACTIVE_LOANS');
    return { item: await items.delete(id).catch(notFoundAs('工具が見つかりません')) };
  });

  app.post('/kiosk/tag-desk/measuring-instruments', withPin, async (request) => {
    const body = instrumentCreateBody.parse(request.body ?? {});
    return { instrument: await instruments.create(body).catch(notFoundAs('計測機器が見つかりません')) };
  });
  app.put('/kiosk/tag-desk/measuring-instruments/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = instrumentUpdateBody.parse(request.body ?? {});
    return { instrument: await instruments.update(id, body).catch(notFoundAs('計測機器が見つかりません')) };
  });
  app.delete('/kiosk/tag-desk/measuring-instruments/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    return { instrument: await instruments.delete(id).catch(notFoundAs('計測機器が見つかりません')) };
  });

  app.post('/kiosk/tag-desk/rigging-gears', withPin, async (request) => {
    const body = riggingCreateBody.parse(request.body ?? {});
    return { riggingGear: await rigging.create(body).catch(notFoundAs('吊具が見つかりません')) };
  });
  app.put('/kiosk/tag-desk/rigging-gears/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = riggingUpdateBody.parse(request.body ?? {});
    return { riggingGear: await rigging.update(id, body).catch(notFoundAs('吊具が見つかりません')) };
  });
  app.delete('/kiosk/tag-desk/rigging-gears/:id', withPin, async (request) => {
    const { id } = idParams.parse(request.params);
    return { riggingGear: await rigging.delete(id).catch(notFoundAs('吊具が見つかりません')) };
  });
}
