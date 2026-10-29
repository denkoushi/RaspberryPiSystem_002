import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { assemblyCheckSheetSaveSchema } from '@raspi-system/shared-types';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { AssemblyCheckSheetService } from '../../services/assembly/check-sheet/check-sheet.service.js';

const importQuery = z.object({ sheetName: z.string().min(1).max(31).optional() });
const listQuery = z.object({ rootId: z.string().guid().optional() });
const idParams = z.object({ id: z.string().guid() });
const MAX_XLSX_BYTES = 12 * 1024 * 1024;

export function registerAssemblyCheckSheetRoutes(
  app: FastifyInstance,
  options: { allowView: preHandlerHookHandler },
  service = new AssemblyCheckSheetService()
): void {
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
