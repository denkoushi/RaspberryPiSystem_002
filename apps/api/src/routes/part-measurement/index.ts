import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import {
  PartMeasurementResolveService,
  PartMeasurementSheetService,
  PartMeasurementTemplateCandidateService,
  PartMeasurementTemplateService,
  PartMeasurementVisualTemplateService
} from '../../services/part-measurement/index.js';
import { requireClientDevice, resolveDeviceScopeKey } from '../kiosk/shared.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from '../../services/part-measurement/part-measurement-constants.js';

const processGroupSchema = z.enum(['cutting', 'grinding']);
const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);

const resolveTicketBodySchema = z.object({
  productNo: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  scannedFhincd: z.string().max(120).optional().nullable(),
  scannedBarcodeRaw: z.string().max(500).optional().nullable(),
  resourceCd: z.string().max(120).optional().nullable()
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
  scheduleRowId: z.string().uuid().optional(),
  allowAlternateResourceTemplate: z.boolean().optional(),
  /** 同一測定対象への追加作成時の整合チェック用 */
  sessionId: z.string().uuid().optional()
});

const findOrOpenSheetBodySchema = z.object({
  productNo: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120),
  scheduleRowId: z.string().uuid().optional().nullable(),
  fseiban: z.string().max(120).optional().nullable(),
  fhincd: z.string().max(120).optional().nullable(),
  fhinmei: z.string().max(500).optional().nullable(),
  machineName: z.string().max(500).optional().nullable(),
  scannedBarcodeRaw: z.string().max(500).optional().nullable()
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
  displayMarker: z.string().max(40).optional().nullable(),
  unit: z.string().max(50).optional().nullable(),
  allowNegative: z.boolean().optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional()
});

const templateScopeSchema = z.enum(['three_key', 'fhincd_resource', 'fhinmei_only']);

const createTemplateBodySchema = z
  .object({
    templateScope: templateScopeSchema.optional().default('three_key'),
    fhincd: z.string().max(120),
    processGroup: processGroupSchema,
    resourceCd: z.string().max(120),
    name: z.string().min(1).max(200),
    items: z.array(templateItemSchema).min(1).max(200),
    visualTemplateId: z.string().uuid().optional().nullable(),
    candidateFhinmei: z.string().max(500).optional().nullable()
  })
  .superRefine((val, ctx) => {
    if (val.templateScope === 'fhinmei_only') {
      const c = (val.candidateFhinmei ?? '').trim();
      if (c.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FHINMEI_ONLY では candidateFhinmei が必須です', path: ['candidateFhinmei'] });
      } else if (c.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FHINMEI 候補キーは 2 文字以上にしてください',
          path: ['candidateFhinmei']
        });
      }
      return;
    }
    if (val.fhincd.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FIHNCD が空です', path: ['fhincd'] });
    }
    const r = val.resourceCd.trim();
    if (r.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '資源CDが空です', path: ['resourceCd'] });
    }
  });

/** 有効テンプレの系譜固定での改版。FHINMEI_ONLY のときのみ candidateFhinmei を変更可 */
const reviseTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    items: z.array(templateItemSchema).min(1).max(200),
    visualTemplateId: z.string().uuid().optional().nullable(),
    candidateFhinmei: z.string().max(500).optional().nullable()
  })
  .superRefine((val, ctx) => {
    if (val.candidateFhinmei === undefined || val.candidateFhinmei === null) {
      return;
    }
    const c = String(val.candidateFhinmei).trim();
    if (c.length > 0 && c.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FHINMEI 候補キーは 2 文字以上にしてください',
        path: ['candidateFhinmei']
      });
    }
  });

/** 候補テンプレを日程の FIHNCD+工程+資源CD 用テンプレへ複製（既存 active があれば再利用） */
const cloneTemplateForScheduleBodySchema = z.object({
  sourceTemplateId: z.string().uuid(),
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120)
});

const listTemplatesQuerySchema = z.object({
  fhincd: z.string().max(120).optional(),
  processGroup: processGroupSchema.optional(),
  resourceCd: z.string().max(120).optional(),
  includeInactive: z.coerce.boolean().optional()
});

const listTemplateCandidatesQuerySchema = z.object({
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120),
  fhinmei: z.string().max(500).optional(),
  q: z.string().max(200).optional()
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
  displayMarker?: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
}) {
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    datumSurface: item.datumSurface,
    measurementPoint: item.measurementPoint,
    measurementLabel: item.measurementLabel,
    displayMarker: item.displayMarker ?? null,
    unit: item.unit,
    allowNegative: item.allowNegative,
    decimalPlaces: item.decimalPlaces
  };
}

function serializeVisualTemplate(v: {
  id: string;
  name: string;
  drawingImageRelativePath: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: v.id,
    name: v.name,
    drawingImageRelativePath: v.drawingImageRelativePath,
    isActive: v.isActive,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString()
  };
}

function serializeTemplateScope(scope: string): 'three_key' | 'fhincd_resource' | 'fhinmei_only' {
  if (scope === 'FHINCD_RESOURCE') return 'fhincd_resource';
  if (scope === 'FHINMEI_ONLY') return 'fhinmei_only';
  return 'three_key';
}

function serializeTemplateProcessGroup(
  processGroup: string
): 'cutting' | 'grinding' | null {
  if (processGroup === 'GRINDING') return 'grinding';
  if (processGroup === 'CUTTING') return 'cutting';
  return null;
}

function serializeTemplate(
  t: {
    id: string;
    fhincd: string;
    resourceCd: string;
    processGroup: string;
    templateScope?: string;
    candidateFhinmei?: string | null;
    name: string;
    version: number;
    isActive: boolean;
    visualTemplateId?: string | null;
    visualTemplate?: Parameters<typeof serializeVisualTemplate>[0] | null;
    items?: Array<Parameters<typeof serializeTemplateItem>[0]>;
  }
) {
  return {
    id: t.id,
    fhincd: t.fhincd,
    resourceCd: t.resourceCd,
    processGroup: serializeTemplateProcessGroup(t.processGroup),
    templateScope: serializeTemplateScope(t.templateScope ?? 'THREE_KEY'),
    candidateFhinmei: t.candidateFhinmei ?? null,
    name: t.name,
    version: t.version,
    isActive: t.isActive,
    visualTemplateId: t.visualTemplateId ?? null,
    visualTemplate: t.visualTemplate ? serializeVisualTemplate(t.visualTemplate) : null,
    items: (t.items ?? []).map(serializeTemplateItem)
  };
}

async function readMultipartFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

type SerializedPartMeasurementSession = {
  id: string;
  productNo: string;
  processGroup: 'cutting' | 'grinding';
  resourceCd: string;
  completedAt: string | null;
  sheets: Array<{
    id: string;
    status: string;
    templateId: string | null;
    templateName: string | null;
    updatedAt: string;
  }>;
};

function serializePartMeasurementSession(
  session: NonNullable<Awaited<ReturnType<PartMeasurementSheetService['getById']>>['session']>
): SerializedPartMeasurementSession {
  return {
    id: session.id,
    productNo: session.productNo,
    processGroup: session.processGroup === 'GRINDING' ? 'grinding' : 'cutting',
    resourceCd: session.resourceCd,
    completedAt: session.completedAt?.toISOString() ?? null,
    sheets: session.sheets.map((sh) => ({
      id: sh.id,
      status: sh.status,
      templateId: sh.templateId,
      templateName: sh.template?.name ?? null,
      updatedAt: sh.updatedAt.toISOString()
    }))
  };
}

type SheetSerializeSource = Awaited<ReturnType<PartMeasurementSheetService['getById']>>;
function serializeSheet(
  sheet: Omit<SheetSerializeSource, 'session'> & { session?: SheetSerializeSource['session'] }
) {
  return {
    id: sheet.id,
    sessionId: sheet.sessionId,
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
    createdByEmployeeId: sheet.createdByEmployeeId,
    createdByEmployeeNameSnapshot: sheet.createdByEmployeeNameSnapshot,
    finalizedByEmployeeId: sheet.finalizedByEmployeeId,
    finalizedByEmployeeNameSnapshot: sheet.finalizedByEmployeeNameSnapshot,
    quantity: sheet.quantity,
    scannedBarcodeRaw: sheet.scannedBarcodeRaw,
    templateId: sheet.templateId,
    clientDeviceId: sheet.clientDeviceId,
    clientDeviceName: sheet.clientDevice?.name ?? null,
    editLockClientDeviceId: sheet.editLockClientDeviceId,
    editLockExpiresAt: sheet.editLockExpiresAt?.toISOString() ?? null,
    editLockClientDeviceName: sheet.editLockClientDevice?.name ?? null,
    cancelledAt: sheet.cancelledAt?.toISOString() ?? null,
    cancelReason: sheet.cancelReason,
    invalidatedAt: sheet.invalidatedAt?.toISOString() ?? null,
    invalidatedReason: sheet.invalidatedReason,
    createdAt: sheet.createdAt.toISOString(),
    updatedAt: sheet.updatedAt.toISOString(),
    finalizedAt: sheet.finalizedAt?.toISOString() ?? null,
    template: sheet.template ? serializeTemplate({ ...sheet.template, items: sheet.template.items }) : null,
    results: (sheet.results ?? []).map((r) => ({
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

function sheetResponsePair(sheet: SheetSerializeSource) {
  return {
    sheet: serializeSheet(sheet),
    session: sheet.session ? serializePartMeasurementSession(sheet.session) : null
  };
}

async function tryGetClientDeviceId(headers: FastifyRequest['headers']): Promise<string | undefined> {
  try {
    const { clientDevice } = await requireClientDevice(headers['x-client-key']);
    return clientDevice.id;
  } catch {
    return undefined;
  }
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
  const templateCandidateService = new PartMeasurementTemplateCandidateService();
  const visualTemplateService = new PartMeasurementVisualTemplateService();

  app.get(
    '/part-measurement/visual-templates',
    { preHandler: allowView, config: { rateLimit: false } },
    async (request) => {
      const q = z
        .object({
          includeInactive: z.coerce.boolean().optional()
        })
        .parse(request.query);
      const list = await visualTemplateService.list(q.includeInactive === true);
      return { visualTemplates: list.map(serializeVisualTemplate) };
    }
  );

  app.post(
    '/part-measurement/visual-templates',
    { preHandler: allowWriteKiosk, config: { rateLimit: false } },
    async (request) => {
      if (!request.isMultipart()) {
        throw new ApiError(
          400,
          'マルチパートフォームデータが必要です（name, file）',
          undefined,
          'MULTIPART_REQUIRED'
        );
      }
      let fileBuffer: Buffer | null = null;
      let mimetype = '';
      let filename = '';
      let name = '';

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') {
            const mf = part as MultipartFile;
            fileBuffer = await readMultipartFile(mf);
            mimetype = mf.mimetype || '';
            filename = mf.filename || 'drawing';
          }
        } else if (part.fieldname === 'name') {
          name = String(part.value ?? '').trim();
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new ApiError(400, '図面画像ファイルが必要です');
      }
      if (fileBuffer.length > PartMeasurementDrawingStorage.getMaxBytes()) {
        throw new ApiError(400, '図面画像が大きすぎます');
      }
      if (!name) {
        name = filename.replace(/\.[^.]+$/, '') || '図面テンプレート';
      }

      let mime = mimetype;
      if (!mime || mime === 'application/octet-stream') {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.png')) mime = 'image/png';
        else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
        else if (lower.endsWith('.webp')) mime = 'image/webp';
      }

      const { relativeUrl } = await PartMeasurementDrawingStorage.saveDrawing(fileBuffer, mime);
      const created = await visualTemplateService.create({
        name: name.slice(0, 200),
        drawingImageRelativePath: relativeUrl
      });
      return { visualTemplate: serializeVisualTemplate(created) };
    }
  );

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
        await verifyScheduleRowOrThrow(body.scheduleRowId, {
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

  app.get('/part-measurement/templates/candidates', { preHandler: allowView }, async (request) => {
    const q = listTemplateCandidatesQuerySchema.parse(request.query);
    const processGroup = q.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
    const rows = await templateCandidateService.listCandidates({
      fhincd: q.fhincd,
      processGroup,
      resourceCd: q.resourceCd,
      fhinmei: q.fhinmei,
      q: q.q
    });
    return {
      candidates: rows.map((row) => ({
        matchKind: row.matchKind,
        selectable: row.selectable,
        itemCount: row.itemCount,
        template: serializeTemplate({ ...row.template, items: [] })
      }))
    };
  });

  app.get('/part-measurement/templates', { preHandler: allowView }, async (request) => {
    const q = listTemplatesQuerySchema.parse(request.query);
    const processGroup =
      q.processGroup === 'grinding' ? 'GRINDING' : q.processGroup === 'cutting' ? 'CUTTING' : undefined;
    const list = await templateService.listTemplates({
      fhincd: q.fhincd,
      processGroup,
      resourceCd: q.resourceCd,
      includeInactive: q.includeInactive === true
    });
    return { templates: list.map((t) => serializeTemplate({ ...t, items: t.items })) };
  });

  app.post('/part-measurement/templates', { preHandler: allowWriteKiosk }, async (request) => {
    const body = createTemplateBodySchema.parse(request.body);
    const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
    const templateScope =
      body.templateScope === 'fhincd_resource'
        ? 'FHINCD_RESOURCE'
        : body.templateScope === 'fhinmei_only'
          ? 'FHINMEI_ONLY'
          : 'THREE_KEY';
    const template = await templateService.createTemplateVersion({
      fhincd: body.fhincd,
      processGroup,
      resourceCd: body.resourceCd,
      name: body.name,
      items: body.items,
      visualTemplateId: body.visualTemplateId ?? null,
      templateScope,
      candidateFhinmei: body.candidateFhinmei
    });
    return {
      template: serializeTemplate({
        ...template,
        visualTemplateId: template.visualTemplateId,
        visualTemplate: template.visualTemplate,
        items: template.items
      })
    };
  });

  app.post(
    '/part-measurement/templates/clone-for-schedule-key',
    { preHandler: allowWriteKiosk, config: { rateLimit: false } },
    async (request) => {
      const body = cloneTemplateForScheduleBodySchema.parse(request.body);
      const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
      const result = await templateService.cloneActiveTemplateToScheduleKey({
        sourceTemplateId: body.sourceTemplateId,
        targetFhincd: body.fhincd,
        targetProcessGroup: processGroup,
        targetResourceCd: body.resourceCd
      });
      return {
        template: serializeTemplate({
          ...result.template,
          visualTemplateId: result.template.visualTemplateId,
          visualTemplate: result.template.visualTemplate,
          items: result.template.items
        }),
        reusedExistingActive: result.reusedExistingActive,
        didClone: result.didClone
      };
    }
  );

  app.post('/part-measurement/templates/:id/revise', { preHandler: allowWriteKiosk }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = reviseTemplateBodySchema.parse(request.body);
    const template = await templateService.reviseActiveTemplate(params.id, {
      name: body.name,
      items: body.items,
      visualTemplateId: body.visualTemplateId,
      candidateFhinmei: body.candidateFhinmei
    });
    return {
      template: serializeTemplate({
        ...template,
        visualTemplateId: template.visualTemplateId,
        visualTemplate: template.visualTemplate,
        items: template.items
      })
    };
  });

  app.post('/part-measurement/templates/:id/retire', { preHandler: allowWriteKiosk }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const template = await templateService.retireActiveTemplate(params.id);
    return {
      template: serializeTemplate({
        ...template,
        visualTemplateId: template.visualTemplateId,
        visualTemplate: template.visualTemplate,
        items: template.items
      })
    };
  });

  app.post('/part-measurement/templates/:id/activate', { preHandler: allowWriteKiosk }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const template = await templateService.setActiveVersion(params.id);
    return {
      template: serializeTemplate({
        ...template,
        visualTemplateId: template.visualTemplateId,
        visualTemplate: template.visualTemplate,
        items: template.items
      })
    };
  });
}
