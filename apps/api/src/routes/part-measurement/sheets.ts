import type { FastifyInstance } from 'fastify';
import { z } from 'zod';


import { verifyProductionScheduleRowOrThrow } from '../../services/production-schedule/verify-production-schedule-row.js';




import { requireClientDevice, resolveDeviceScopeKey } from '../kiosk/shared.js';




import {
  patchInspectionDrawingEvaluationSheetBodySchema,
  toInspectionDrawingEvaluationPatchInput
} from '../../services/part-measurement/part-measurement-evaluation-sheet.contract.js';
import {
  assertInspectionDrawingEvaluationSheet,
  assertProductionPartMeasurementSheet
} from '../../services/part-measurement/part-measurement-template-guards.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from '../../services/part-measurement/part-measurement-constants.js';
import {
  processGroupSchema,
  resolveTicketBodySchema,
  createSheetBodySchema,
  findOrOpenSheetBodySchema,
  patchSheetBodySchema,
  serializeTemplate,
  serializeSheet,
  sheetResponsePair,
  tryGetClientDeviceId,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerSheetRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowView,
    allowWriteKiosk,
    resolveService,
    sheetService
  } = deps;

    app.post(
      '/part-measurement/resolve-ticket',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const body = resolveTicketBodySchema.parse(request.body);
        let deviceScopeKey: string | undefined;
        try {
          const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
          deviceScopeKey = resolveDeviceScopeKey(clientDevice);
        } catch {
          deviceScopeKey = undefined;
        }

        const resolved = await resolveService.resolveTicket({
          productNo: body.productNo,
          processGroup: body.processGroup,
          scannedFhincd: body.scannedFhincd,
          resourceCd: body.resourceCd,
          deviceScopeKey
        });

        return {
          processGroup: resolved.processGroup,
          ambiguous: resolved.ambiguous,
          fhincdMismatch: resolved.fhincdMismatch,
          candidates: resolved.candidates.map((c) => ({
            scheduleRowId: c.rowId,
            fseiban: c.fseiban,
            productNo: c.productNo,
            fhincd: c.fhincd,
            fhinmei: c.fhinmei,
            resourceCd: c.fsigencd,
            fkojun: c.fkojun,
            machineName: c.machineName
          })),
          selected: resolved.selected
            ? {
                scheduleRowId: resolved.selected.rowId,
                fseiban: resolved.selected.fseiban,
                productNo: resolved.selected.productNo,
                fhincd: resolved.selected.fhincd,
                fhinmei: resolved.selected.fhinmei,
                resourceCd: resolved.selected.fsigencd,
                fkojun: resolved.selected.fkojun,
                machineName: resolved.selected.machineName
              }
            : null,
          template: resolved.template ? serializeTemplate({ ...resolved.template, items: resolved.template.items }) : null
        };
      }
    );

    app.post(
      '/part-measurement/sheets',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const body = createSheetBodySchema.parse(request.body);
        if (body.scheduleRowId) {
          await verifyProductionScheduleRowOrThrow(body.scheduleRowId, {
            productNo: body.productNo,
            fseiban: body.fseiban
          });
        }
        let clientDeviceId: string | undefined;
        try {
          const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
          clientDeviceId = clientDevice.id;
        } catch {
          clientDeviceId = undefined;
        }
        const resourceCdSnapshot =
          body.resourceCdSnapshot?.trim() && body.resourceCdSnapshot.trim().length > 0
            ? body.resourceCdSnapshot.trim()
            : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
        const sheet = await sheetService.createDraft({
          ...body,
          resourceCdSnapshot,
          clientDeviceId,
          allowAlternateResourceTemplate: body.allowAlternateResourceTemplate,
          sessionId: body.sessionId
        });
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/sheets/find-or-open',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const body = findOrOpenSheetBodySchema.parse(request.body);
        if (body.scheduleRowId && body.fseiban) {
          await verifyProductionScheduleRowOrThrow(body.scheduleRowId, {
            productNo: body.productNo,
            fseiban: body.fseiban
          });
        }
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const result = await sheetService.findOrOpen({
          productNo: body.productNo,
          processGroup: body.processGroup,
          resourceCd: body.resourceCd,
          scheduleRowId: body.scheduleRowId,
          fseiban: body.fseiban,
          fhincd: body.fhincd,
          fhinmei: body.fhinmei,
          machineName: body.machineName,
          scannedBarcodeRaw: body.scannedBarcodeRaw,
          clientDeviceId
        });
        if (result.mode === 'needs_resolve') {
          return { mode: result.mode, sheet: null, session: null, header: null };
        }
        if (result.mode === 'needs_template') {
          return {
            mode: result.mode,
            sheet: null,
            session: null,
            header: result.header
          };
        }
        const full = await sheetService.getById(result.sheet.id);
        return {
          mode: result.mode,
          ...sheetResponsePair(full)
        };
      }
    );

    app.get(
      '/part-measurement/sheets/drafts',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const q = z
          .object({
            limit: z.coerce.number().int().min(1).max(100).optional().default(30),
            cursor: z.string().uuid().optional()
          })
          .parse(request.query);
        const { sheets, nextCursor } = await sheetService.listDrafts({ limit: q.limit, cursor: q.cursor });
        return { sheets: sheets.map(serializeSheet), nextCursor };
      }
    );

    app.get(
      '/part-measurement/sheets/finalized',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const q = z
          .object({
            limit: z.coerce.number().int().min(1).max(100).optional().default(30),
            cursor: z.string().uuid().optional(),
            productNo: z.string().max(120).optional(),
            fseiban: z.string().max(120).optional(),
            fhincd: z.string().max(120).optional(),
            processGroup: processGroupSchema.optional(),
            resourceCd: z.string().max(120).optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            includeCancelled: z.coerce.boolean().optional(),
            includeInvalidated: z.coerce.boolean().optional()
          })
          .parse(request.query);
        const processGroup =
          q.processGroup === 'grinding' ? 'GRINDING' : q.processGroup === 'cutting' ? 'CUTTING' : null;
        const { sheets, nextCursor } = await sheetService.listFinalized({
          limit: q.limit,
          cursor: q.cursor,
          productNo: q.productNo,
          fseiban: q.fseiban,
          fhincd: q.fhincd,
          processGroup,
          resourceCd: q.resourceCd,
          dateFrom: q.dateFrom ? new Date(q.dateFrom) : null,
          dateTo: q.dateTo ? new Date(q.dateTo) : null,
          includeCancelled: q.includeCancelled === true,
          includeInvalidated: q.includeInvalidated === true
        });
        return { sheets: sheets.map(serializeSheet), nextCursor };
      }
    );

    app.get(
      '/part-measurement/sheets/:id',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const sheet = await sheetService.getById(params.id);
        return sheetResponsePair(sheet);
      }
    );

    app.patch(
      '/part-measurement/sheets/:id',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = patchSheetBodySchema.parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertProductionPartMeasurementSheet(existing);
        const sheet = await sheetService.patch(params.id, body, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/inspection-drawing/evaluation-sheets',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const body = z.object({ templateId: z.string().uuid() }).parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const sheet = await sheetService.createInspectionDrawingEvaluationDraft(
          body.templateId,
          clientDeviceId
        );
        return sheetResponsePair(sheet);
      }
    );

    app.patch(
      '/part-measurement/inspection-drawing/evaluation-sheets/:id',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const parsed = patchInspectionDrawingEvaluationSheetBodySchema.parse(request.body);
        const body = toInspectionDrawingEvaluationPatchInput(parsed);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertInspectionDrawingEvaluationSheet(existing);
        const sheet = await sheetService.patch(params.id, body, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/sheets/:id/transfer-edit-lock',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({ confirm: z.boolean().optional().default(false) }).parse(request.body ?? {});
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertProductionPartMeasurementSheet(existing);
        const sheet = await sheetService.transferEditLock(params.id, clientDeviceId, body.confirm);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/sheets/:id/finalize',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertProductionPartMeasurementSheet(existing);
        const sheet = await sheetService.finalize(params.id, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/inspection-drawing/evaluation-sheets/:id/finalize',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertInspectionDrawingEvaluationSheet(existing);
        const sheet = await sheetService.finalize(params.id, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/sheets/:id/cancel',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({ reason: z.string().min(1).max(2000) }).parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertProductionPartMeasurementSheet(existing);
        const sheet = await sheetService.cancelDraft(params.id, body.reason, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.post(
      '/part-measurement/sheets/:id/invalidate',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({ reason: z.string().min(1).max(2000) }).parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const existing = await sheetService.getById(params.id);
        assertProductionPartMeasurementSheet(existing);
        const sheet = await sheetService.invalidateFinalized(params.id, body.reason, clientDeviceId);
        return sheetResponsePair(sheet);
      }
    );

    app.get(
      '/part-measurement/sheets/:id/export.csv',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const sheet = await sheetService.getById(params.id);
        const csv = sheetService.buildSheetCsv(sheet);
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="part-measurement-${params.id}.csv"`);
        return reply.send(csv);
      }
    );
}
