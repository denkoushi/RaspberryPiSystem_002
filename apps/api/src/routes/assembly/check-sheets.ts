import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { assemblyCheckSheetSaveSchema, assemblyCheckSheetCreateSchema, assemblyCheckSheetStampSchema, assemblyCheckSheetConditionSchema, assemblyCheckSheetActorSchema } from '@raspi-system/shared-types';
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
  app.get('/assembly/check-sheets/:id/paper-layout', { preHandler: options.allowView }, async (request) =>
    kioskService.paperLayout(idParams.parse(request.params).id));
  app.get('/assembly/check-sheets/:id/paper.xlsx', { preHandler: options.allowView }, async (request, reply) => {
    const { buffer, filename } = await kioskService.paperXlsx(idParams.parse(request.params).id);
    const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="check-sheet.xlsx"; filename*=UTF-8''${encoded}`)
      .send(buffer);
  });
  app.put('/assembly/check-sheets/:id/revision', { preHandler: options.allowWriteKiosk }, async (request) => {
    const input = z.object({ revisionRootId: z.string().guid() }).parse(request.body);
    const device = await tryGetClientDevice(request.headers);
    return kioskService.changeRevision(idParams.parse(request.params).id, { ...input, clientDeviceId: device?.id ?? null });
  });
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
  app.post('/assembly/check-sheets/imports', { preHandler: options.allowWriteKiosk }, async (request) => {
    const { sheetName } = importQuery.parse(request.query);
    const file = await request.file({ limits: { fileSize: MAX_XLSX_BYTES, files: 1, fields: 0 } });
    if (!file || !/\.xlsx$/i.test(file.filename)) throw new ApiError(400, '.xlsxファイルを指定してください');
    const buffer = await file.toBuffer();
    if (!buffer.length) throw new ApiError(400, 'ファイルが空です');
    if (file.file.truncated) throw new ApiError(413, 'ファイルサイズが上限を超えています');
    return service.importWorkbook(buffer, file.filename, sheetName);
  });
  app.post('/assembly/check-sheets/revisions', { preHandler: options.allowWriteKiosk }, async (request) => {
    const device = request.user ? null : await tryGetClientDevice(request.headers);
    const createdBy = request.user?.id ?? (device ? `client:${device.id}` : null);
    if (!createdBy) throw new ApiError(401, '作成者を特定できません');
    return service.saveRevision(assemblyCheckSheetSaveSchema.parse(request.body), createdBy);
  });
  app.get('/assembly/check-sheets/revisions', { preHandler: options.allowView }, async (request) => {
    return service.listRevisions(listQuery.parse(request.query).rootId);
  });
  app.get('/assembly/check-sheets/revisions/:id', { preHandler: options.allowView }, async (request) => {
    return service.getRevision(idParams.parse(request.params).id);
  });
}
