import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import {
  PartMeasurementResolveService,
  PartMeasurementSheetService,
  PartMeasurementTemplateService
} from '../../services/part-measurement/index.js';
import { requireClientDevice, resolveDeviceScopeKey } from '../kiosk/shared.js';

const processGroupSchema = z.enum(['cutting', 'grinding']);
const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);

const resolveTicketBodySchema = z.object({
  productNo: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  scannedFhincd: z.string().max(120).optional().nullable(),
  scannedBarcodeRaw: z.string().max(500).optional().nullable()
});

const createSheetBodySchema = z.object({
  productNo: z.string().min(1).max(120),
  fseiban: z.string().min(1).max(120),
  fhincd: z.string().min(1).max(120),
  fhinmei: z.string().min(1).max(500),
  machineName: z.string().max(500).optional().nullable(),
  resourceCdSnapshot: z.string().max(120).optional().nullable(),
  processGroup: processGroupSchema,
  templateId: z.string().uuid(),
  scannedBarcodeRaw: z.string().max(500).optional().nullable(),
  scheduleRowId: z.string().uuid().optional()
});

const patchSheetBodySchema = z.object({
  quantity: z.number().int().min(0).max(2000).optional().nullable(),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  clearEmployee: z.boolean().optional(),
  results: z
    .array(
      z.object({
        pieceIndex: z.number().int().min(0).max(1999),
        templateItemId: z.string().uuid(),
        value: z.union([z.string(), z.number(), z.null()]).optional()
      })
    )
    .optional()
});

const templateItemSchema = z.object({
  sortOrder: z.number().int().min(0).max(999),
  datumSurface: z.string().min(1).max(500),
  measurementPoint: z.string().min(1).max(500),
  measurementLabel: z.string().min(1).max(500),
  unit: z.string().max(50).optional().nullable(),
  allowNegative: z.boolean().optional()
});

const createTemplateBodySchema = z.object({
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  name: z.string().min(1).max(200),
  items: z.array(templateItemSchema).min(1).max(200)
});

const listTemplatesQuerySchema = z.object({
  fhincd: z.string().max(120).optional(),
  processGroup: processGroupSchema.optional(),
  includeInactive: z.coerce.boolean().optional()
});

function decimalToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return String(value);
  }
  return String(value);
}

function serializeTemplateItem(item: {
  id: string;
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  unit: string | null;
  allowNegative: boolean;
}) {
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    datumSurface: item.datumSurface,
    measurementPoint: item.measurementPoint,
    measurementLabel: item.measurementLabel,
    unit: item.unit,
    allowNegative: item.allowNegative
  };
}

function serializeTemplate(
  t: {
    id: string;
    fhincd: string;
    processGroup: string;
    name: string;
    version: number;
    isActive: boolean;
    items?: Array<Parameters<typeof serializeTemplateItem>[0]>;
  }
) {
  return {
    id: t.id,
    fhincd: t.fhincd,
    processGroup: t.processGroup === 'GRINDING' ? 'grinding' : 'cutting',
    name: t.name,
    version: t.version,
    isActive: t.isActive,
    items: (t.items ?? []).map(serializeTemplateItem)
  };
}

function serializeSheet(
  sheet: Awaited<ReturnType<PartMeasurementSheetService['getById']>>
) {
  return {
    id: sheet.id,
    status: sheet.status,
    productNo: sheet.productNo,
    fseiban: sheet.fseiban,
    fhincd: sheet.fhincd,
    fhinmei: sheet.fhinmei,
    machineName: sheet.machineName,
    resourceCdSnapshot: sheet.resourceCdSnapshot,
    processGroupSnapshot: sheet.processGroupSnapshot === 'GRINDING' ? 'grinding' : 'cutting',
    employeeId: sheet.employeeId,
    employeeNameSnapshot: sheet.employeeNameSnapshot,
    quantity: sheet.quantity,
    scannedBarcodeRaw: sheet.scannedBarcodeRaw,
    templateId: sheet.templateId,
    clientDeviceId: sheet.clientDeviceId,
    createdAt: sheet.createdAt.toISOString(),
    updatedAt: sheet.updatedAt.toISOString(),
    finalizedAt: sheet.finalizedAt?.toISOString() ?? null,
    template: sheet.template ? serializeTemplate({ ...sheet.template, items: sheet.template.items }) : null,
    results: sheet.results.map((r) => ({
      id: r.id,
      pieceIndex: r.pieceIndex,
      templateItemId: r.templateItemId,
      value: decimalToString(r.value)
    })),
    employee: sheet.employee
      ? { id: sheet.employee.id, displayName: sheet.employee.displayName, employeeCode: sheet.employee.employeeCode }
      : null
  };
}

async function verifyScheduleRowOrThrow(scheduleRowId: string, expected: { productNo: string; fseiban: string }) {
  const row = await prisma.csvDashboardRow.findFirst({
    where: { id: scheduleRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  if (!row) {
    throw new ApiError(400, '日程行が見つかりません');
  }
  const data = row.rowData as Record<string, unknown>;
  const pn = typeof data.ProductNo === 'string' ? data.ProductNo.trim() : '';
  const fs = typeof data.FSEIBAN === 'string' ? data.FSEIBAN.trim() : '';
  if (pn !== expected.productNo.trim() || fs !== expected.fseiban.trim()) {
    throw new ApiError(400, '日程行が製造order番号・製番と一致しません');
  }
}

export async function registerPartMeasurementRoutes(app: FastifyInstance): Promise<void> {
  const isAuthOnlyError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const e = error as { statusCode?: number; errorCode?: string };
    return (e.statusCode === 401 && (e.errorCode == null || authOnlyErrorCodes.has(e.errorCode)));
  };

  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const allowClientKey = async (request: FastifyRequest) => {
    const rawClientKey = request.headers['x-client-key'];
    let clientKey: string | undefined;
    if (typeof rawClientKey === 'string') {
      try {
        const parsed = JSON.parse(rawClientKey);
        clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
      } catch {
        clientKey = rawClientKey;
      }
    } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
      clientKey = rawClientKey[0];
    }

    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const client = await prisma.clientDevice.findUnique({ where: { apiKey: clientKey } });
    if (!client) {
      throw new ApiError(403, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
    }
  };

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) {
          throw error;
        }
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  const allowWriteKiosk = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canWrite(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) {
          throw error;
        }
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  const resolveService = new PartMeasurementResolveService();
  const sheetService = new PartMeasurementSheetService();
  const templateService = new PartMeasurementTemplateService();

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
        await verifyScheduleRowOrThrow(body.scheduleRowId, {
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
      const sheet = await sheetService.createDraft({
        ...body,
        clientDeviceId
      });
      return { sheet: serializeSheet(sheet) };
    }
  );

  app.get(
    '/part-measurement/sheets/:id',
    { preHandler: allowView, config: { rateLimit: false } },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const sheet = await sheetService.getById(params.id);
      return { sheet: serializeSheet(sheet) };
    }
  );

  app.patch(
    '/part-measurement/sheets/:id',
    { preHandler: allowWriteKiosk, config: { rateLimit: false } },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = patchSheetBodySchema.parse(request.body);
      const sheet = await sheetService.patch(params.id, body);
      return { sheet: serializeSheet(sheet) };
    }
  );

  app.post(
    '/part-measurement/sheets/:id/finalize',
    { preHandler: allowWriteKiosk, config: { rateLimit: false } },
    async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const sheet = await sheetService.finalize(params.id);
      return { sheet: serializeSheet(sheet) };
    }
  );

  app.get('/part-measurement/templates', { preHandler: canView }, async (request) => {
    const q = listTemplatesQuerySchema.parse(request.query);
    const processGroup =
      q.processGroup === 'grinding' ? 'GRINDING' : q.processGroup === 'cutting' ? 'CUTTING' : undefined;
    const list = await templateService.listTemplates({
      fhincd: q.fhincd,
      processGroup,
      includeInactive: q.includeInactive === true
    });
    return { templates: list.map((t) => serializeTemplate({ ...t, items: t.items })) };
  });

  app.post('/part-measurement/templates', { preHandler: canWrite }, async (request) => {
    const body = createTemplateBodySchema.parse(request.body);
    const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
    const template = await templateService.createTemplateVersion({
      fhincd: body.fhincd,
      processGroup,
      name: body.name,
      items: body.items
    });
    return { template: serializeTemplate({ ...template, items: template.items }) };
  });

  app.post('/part-measurement/templates/:id/activate', { preHandler: canWrite }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const template = await templateService.setActiveVersion(params.id);
    return { template: serializeTemplate({ ...template, items: template.items }) };
  });
}
