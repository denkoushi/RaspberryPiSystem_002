import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { assemblyCheckSheetSaveSchema, assemblyCheckSheetCreateSchema, assemblyCheckSheetStampSchema, assemblyCheckSheetConditionSchema, assemblyCheckSheetActorSchema } from '@raspi-system/shared-types';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { AssemblyCheckSheetService } from '../../services/assembly/check-sheet/check-sheet.service.js';

import { tryGetClientDevice } from './shared.js';
import { AssemblyCheckSheetKioskService } from '../../services/assembly/check-sheet/check-sheet-kiosk.service.js';

const importQuery = z.object({ sheetName: z.string().min(1).max(31).optional() });
const listQuery = z.object({ rootId: z.string().guid().optional() });
const idParams = z.object({ id: z.string().guid() });
const MAX_XLSX_BYTES = 12 * 1024 * 1024;

export function registerAssemblyCheckSheetRoutes(
  app: FastifyInstance,
  options: { allowView: preHandlerHookHandler; allowWriteKiosk: preHandlerHookHandler },
  service = new AssemblyCheckSheetService(),
  kioskService = new AssemblyCheckSheetKioskService()
): void {
  app.post('/assembly/check-sheets', { preHandler: options.allowWriteKiosk }, async (request) => {
    const input = assemblyCheckSheetCreateSchema.parse(request.body);
    const device = await tryGetClientDevice(request.headers);
    return kioskService.create({ ...input, clientDeviceId: device?.id ?? null });
  });
  app.get('/assembly/check-sheets/:id', { preHandler: options.allowView }, async (request) =>
    kioskService.get(idParams.parse(request.params).id));
  app.post('/assembly/check-sheets/:id/stamps', { preHandler: options.allowWriteKiosk }, async (request) => {
    const input = assemblyCheckSheetStampSchema.parse(request.body);
    const device = await tryGetClientDevice(request.headers);
    return kioskService.stamp(idParams.parse(request.params).id, { ...input, clientDeviceId: device?.id ?? null });
  });
  app.post('/assembly/check-sheets/:id/conditions', { preHandler: options.allowWriteKiosk }, async (request) => {
    const input = assemblyCheckSheetConditionSchema.parse(request.body);
    const device = await tryGetClientDevice(request.headers);
    return kioskService.condition(idParams.parse(request.params).id, { ...input, clientDeviceId: device?.id ?? null });
  });
  for (const action of ['pause', 'resume', 'complete'] as const) {
    app.post(`/assembly/check-sheets/:id/${action}`, { preHandler: options.allowWriteKiosk }, async (request) => {
      const input = assemblyCheckSheetActorSchema.parse(request.body);
      const device = await tryGetClientDevice(request.headers);
      return kioskService.transition(idParams.parse(request.params).id, action, { ...input, clientDeviceId: device?.id ?? null });
    });
  }
  const adminOnly = authorizeRoles('ADMIN');
  app.post('/assembly/check-sheets/imports', { preHandler: adminOnly }, async (request) => {
    const { sheetName } = importQuery.parse(request.query);
    const file = await request.file({ limits: { fileSize: MAX_XLSX_BYTES, files: 1, fields: 0 } });
    if (!file || !/\.xlsx$/i.test(file.filename)) throw new ApiError(400, '.xlsxファイルを指定してください');
    const buffer = await file.toBuffer();
    if (!buffer.length) throw new ApiError(400, 'ファイルが空です');
    if (file.file.truncated) throw new ApiError(413, 'ファイルサイズが上限を超えています');
    return service.importWorkbook(buffer, file.filename, sheetName);
  });
  app.post('/assembly/check-sheets/revisions', { preHandler: adminOnly }, async (request) => {
    return service.saveRevision(assemblyCheckSheetSaveSchema.parse(request.body), request.user!.id);
  });
  app.get('/assembly/check-sheets/revisions', { preHandler: options.allowView }, async (request) => {
    return service.listRevisions(listQuery.parse(request.query).rootId);
  });
  app.get('/assembly/check-sheets/revisions/:id', { preHandler: options.allowView }, async (request) => {
    return service.getRevision(idParams.parse(request.params).id);
  });
}
