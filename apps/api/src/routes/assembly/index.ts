import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  importAssemblyProcedureDocumentAndSave,
  resolveAssemblyProcedureMultipartReadLimit
} from '../../lib/assembly-procedure-document-import.js';
import { convertDrawingUploadToPreviewBuffer } from '../../lib/part-measurement-drawing-preview.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { requireClientDevice } from '../kiosk/shared.js';
import {
  AssemblyExcelExportService,
  AssemblyProcedureDocumentService,
  AssemblyTemplateService,
  AssemblyWorkSessionService,
  TORQUE_INPUT_PORT_SOURCES,
  toPrismaTorqueInputSource,
  type AssemblyTemplateAreaInput,
  type AssemblyTemplateDetail,
  type AssemblyWorkSessionDetail
} from '../../services/assembly/index.js';

const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);
const optionalTrueOnlyBooleanSchema = z
  .union([z.literal('true'), z.literal(true)])
  .optional()
  .transform((value) => value === true || value === 'true');

const idParamSchema = z.object({ id: z.string().uuid() });

const boltInputSchema = z.object({
  sortOrder: z.coerce.number().int().min(0),
  tighteningId: z.string().trim().min(1).max(120),
  markerNo: z.coerce.number().int().min(1).max(999),
  xRatio: z.coerce.number().min(0).max(1),
  yRatio: z.coerce.number().min(0).max(1),
  boltSpec: z.string().trim().min(1).max(200),
  nominalTorque: z.coerce.number(),
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  unit: z.string().trim().min(1).max(40)
});

const areaInputSchema = z.object({
  sortOrder: z.coerce.number().int().min(0),
  processNo: z.string().trim().min(1).max(80),
  areaCode: z.string().trim().min(1).max(80),
  areaName: z.string().trim().min(1).max(200),
  unitCode: z.string().trim().min(1).max(80),
  requireManualAdvance: z.boolean().optional(),
  bolts: z.array(boltInputSchema).min(1)
});

const templateBodySchema = z.object({
  modelCode: z.string().trim().min(1).max(120),
  procedurePattern: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  procedureDocumentId: z.string().uuid(),
  areas: z.array(areaInputSchema).min(1)
});

const templateReviseBodySchema = templateBodySchema.partial().extend({
  areas: z.array(areaInputSchema).min(1).optional()
});

const startSessionBodySchema = z.object({
  templateId: z.string().uuid(),
  productNo: z.string().trim().min(1).max(120),
  serialNo: z.string().trim().min(1).max(120),
  nameplateNo: z.string().trim().min(1).max(120),
  operatorEmployeeId: z.string().trim().max(120).optional().nullable(),
  operatorNameSnapshot: z.string().trim().min(1).max(120),
  targetUnit: z.string().trim().min(1).max(120),
  torqueWrenchId: z.string().trim().min(1).max(120)
});

const recordTorqueBodySchema = z.object({
  value: z.coerce.number(),
  source: z.enum(TORQUE_INPUT_PORT_SOURCES).default('manual'),
  rawPayload: z.unknown().optional()
});

function decimalToString(value: { toString(): string } | number | string | null | undefined): string | null {
  return value == null ? null : value.toString();
}

function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function serializeProcedureDocument(doc: {
  id: string;
  name: string;
  imageRelativePath: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    name: doc.name,
    imageRelativePath: doc.imageRelativePath,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

function serializeTemplate(template: AssemblyTemplateDetail) {
  return {
    id: template.id,
    modelCode: template.modelCode,
    procedurePattern: template.procedurePattern,
    name: template.name,
    version: template.version,
    isActive: template.isActive,
    procedureDocumentId: template.procedureDocumentId,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    procedureDocument: serializeProcedureDocument(template.procedureDocument),
    areas: template.areas.map((area) => ({
      id: area.id,
      templateId: area.templateId,
      sortOrder: area.sortOrder,
      processNo: area.processNo,
      areaCode: area.areaCode,
      areaName: area.areaName,
      unitCode: area.unitCode,
      requireManualAdvance: area.requireManualAdvance,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
      bolts: area.bolts.map((bolt) => ({
        id: bolt.id,
        areaId: bolt.areaId,
        sortOrder: bolt.sortOrder,
        tighteningId: bolt.tighteningId,
        markerNo: bolt.markerNo,
        xRatio: decimalToString(bolt.xRatio),
        yRatio: decimalToString(bolt.yRatio),
        boltSpec: bolt.boltSpec,
        nominalTorque: decimalToString(bolt.nominalTorque),
        lowerLimit: decimalToString(bolt.lowerLimit),
        upperLimit: decimalToString(bolt.upperLimit),
        unit: bolt.unit,
        createdAt: bolt.createdAt.toISOString(),
        updatedAt: bolt.updatedAt.toISOString()
      }))
    }))
  };
}

function serializeSession(session: AssemblyWorkSessionDetail) {
  return {
    id: session.id,
    templateId: session.templateId,
    status: session.status.toLowerCase(),
    productNo: session.productNo,
    serialNo: session.serialNo,
    nameplateNo: session.nameplateNo,
    operatorEmployeeId: session.operatorEmployeeId,
    operatorNameSnapshot: session.operatorNameSnapshot,
    targetUnit: session.targetUnit,
    torqueWrenchId: session.torqueWrenchId,
    clientDeviceId: session.clientDeviceId,
    clientDeviceNameSnapshot: session.clientDeviceNameSnapshot,
    currentAreaId: session.currentAreaId,
    currentBoltId: session.currentBoltId,
    startedAt: session.startedAt.toISOString(),
    completedAt: dateToIso(session.completedAt),
    cancelledAt: dateToIso(session.cancelledAt),
    cancelReason: session.cancelReason,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    template: serializeTemplate(session.template),
    torqueRecords: session.torqueRecords.map((record) => ({
      id: record.id,
      sessionId: record.sessionId,
      templateBoltId: record.templateBoltId,
      attempt: record.attempt,
      inputSource: record.inputSource.toLowerCase(),
      rawPayload: record.rawPayload,
      value: decimalToString(record.value),
      judgement: record.judgement.toLowerCase(),
      accepted: record.accepted,
      ignoredReason: record.ignoredReason,
      recordedAt: record.recordedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      tighteningId: record.templateBolt.tighteningId,
      markerNo: record.templateBolt.markerNo,
      areaId: record.templateBolt.areaId,
      areaName: record.templateBolt.area.areaName
    })),
    restartLogs: session.restartLogs.map((log) => ({
      id: log.id,
      sessionId: log.sessionId,
      areaId: log.areaId,
      reason: log.reason,
      createdAt: log.createdAt.toISOString()
    }))
  };
}

async function readMultipartFile(file: MultipartFile, maxBytes: number, tooLargeMessage: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of file.file) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new ApiError(400, tooLargeMessage);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function tryGetClientDevice(headers: FastifyRequest['headers']): Promise<{
  id: string;
  name: string;
} | null> {
  try {
    const { clientDevice } = await requireClientDevice(headers['x-client-key']);
    return { id: clientDevice.id, name: clientDevice.name };
  } catch {
    return null;
  }
}

export async function registerAssemblyRoutes(app: FastifyInstance): Promise<void> {
  const isAuthOnlyError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const e = error as { statusCode?: number; errorCode?: string };
    return e.statusCode === 401 && (e.errorCode == null || authOnlyErrorCodes.has(e.errorCode));
  };

  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) throw error;
      }
    }
    await requireClientDevice(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  };

  const allowWriteKiosk = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canWrite(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) throw error;
      }
    }
    await requireClientDevice(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  };

  const procedureService = new AssemblyProcedureDocumentService();
  const templateService = new AssemblyTemplateService();
  const sessionService = new AssemblyWorkSessionService();
  const excelService = new AssemblyExcelExportService(sessionService);

  app.post('/assembly/procedure-documents/preview', { preHandler: allowWriteKiosk }, async (request, reply) => {
    if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
    let fileBuffer: Buffer | null = null;
    let mimetype = '';
    let filename = '';
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const mf = part as MultipartFile;
        mimetype = mf.mimetype || '';
        filename = mf.filename || 'procedure';
        const { maxBytes, tooLargeMessage } = resolveAssemblyProcedureMultipartReadLimit(mimetype, filename);
        fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
      }
    }
    if (!fileBuffer) throw new ApiError(400, '手順書ファイルが必要です');
    const { buffer, contentType } = await convertDrawingUploadToPreviewBuffer({ buffer: fileBuffer, mimetype, filename });
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(buffer);
  });

  app.get('/assembly/procedure-documents', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const documents = await procedureService.list({ includeInactive: q.includeInactive, q: q.q, limit: q.limit });
    return { documents: documents.map(serializeProcedureDocument) };
  });

  app.get('/assembly/procedure-documents/:id', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const doc = await procedureService.getById(params.id, { includeInactive: true });
    if (!doc) return reply.status(404).send({ message: '手順書が見つかりません' });
    return { document: serializeProcedureDocument(doc) };
  });

  app.post('/assembly/procedure-documents', { preHandler: allowWriteKiosk }, async (request) => {
    if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
    let fileBuffer: Buffer | null = null;
    let mimetype = '';
    let filename = '';
    let name = '';
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const mf = part as MultipartFile;
        mimetype = mf.mimetype || '';
        filename = mf.filename || 'procedure';
        const { maxBytes, tooLargeMessage } = resolveAssemblyProcedureMultipartReadLimit(mimetype, filename);
        fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
      } else if (part.type === 'field' && part.fieldname === 'name') {
        name = String(part.value ?? '').trim();
      }
    }
    if (!fileBuffer) throw new ApiError(400, '手順書ファイルが必要です');
    const importResult = await importAssemblyProcedureDocumentAndSave({ buffer: fileBuffer, mimetype, filename });
    try {
      const doc = await procedureService.create({
        name: name || filename.replace(/\.[^.]+$/, '') || '組立手順書',
        imageRelativePath: importResult.relativeUrl
      });
      return { document: serializeProcedureDocument(doc) };
    } catch (error) {
      await AssemblyProcedureImageStorage.deleteImage(importResult.relativeUrl).catch(() => undefined);
      throw error;
    }
  });

  app.patch('/assembly/procedure-documents/:id', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(request.body);
    const doc = await procedureService.rename(params.id, body.name);
    return { document: serializeProcedureDocument(doc) };
  });

  app.delete('/assembly/procedure-documents/:id', { preHandler: allowWriteKiosk }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const result = await procedureService.retire(params.id);
    if (result === 'not_found') return reply.status(404).send({ message: '手順書が見つかりません' });
    return reply.status(204).send();
  });

  app.get('/assembly/templates', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        modelCode: z.string().optional(),
        procedurePattern: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const templates = await templateService.list(q);
    return { templates: templates.map(serializeTemplate) };
  });

  app.get('/assembly/templates/:id', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const template = await templateService.getById(params.id, { includeInactive: true });
    if (!template) return reply.status(404).send({ message: 'テンプレートが見つかりません' });
    return { template: serializeTemplate(template) };
  });

  app.post('/assembly/templates', { preHandler: allowWriteKiosk }, async (request) => {
    const body = templateBodySchema.parse(request.body);
    const template = await templateService.create({ ...body, areas: body.areas as AssemblyTemplateAreaInput[] });
    return { template: serializeTemplate(template) };
  });

  app.post('/assembly/templates/:id/revise', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = templateReviseBodySchema.parse(request.body);
    const template = await templateService.revise(params.id, {
      ...body,
      areas: body.areas as AssemblyTemplateAreaInput[] | undefined
    });
    return { template: serializeTemplate(template) };
  });

  app.delete('/assembly/templates/:id', { preHandler: allowWriteKiosk }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const result = await templateService.retire(params.id);
    if (result === 'not_found') return reply.status(404).send({ message: 'テンプレートが見つかりません' });
    return reply.status(204).send();
  });

  app.post('/assembly/work-sessions', { preHandler: allowWriteKiosk }, async (request) => {
    const body = startSessionBodySchema.parse(request.body);
    const clientDevice = await tryGetClientDevice(request.headers);
    const session = await sessionService.start({
      ...body,
      clientDeviceId: clientDevice?.id ?? null,
      clientDeviceNameSnapshot: clientDevice?.name ?? null
    });
    return { session: serializeSession(session) };
  });

  app.get('/assembly/work-sessions/:id', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.getDetail(params.id);
    if (!session) return reply.status(404).send({ message: '作業セッションが見つかりません' });
    return { session: serializeSession(session) };
  });

  app.post('/assembly/work-sessions/:id/record-torque', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = recordTorqueBodySchema.parse(request.body);
    const result = await sessionService.recordTorque({
      sessionId: params.id,
      value: body.value,
      inputSource: toPrismaTorqueInputSource(body.source),
      rawPayload: body.rawPayload ?? { source: body.source, value: body.value }
    });
    return { session: serializeSession(result.session), outcome: result.outcome };
  });

  app.post('/assembly/work-sessions/:id/advance-area', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.advanceArea(params.id);
    return { session: serializeSession(session) };
  });

  app.post('/assembly/work-sessions/:id/restart-area', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ areaId: z.string().uuid().optional().nullable(), reason: z.string().max(500).optional().nullable() }).parse(request.body ?? {});
    const session = await sessionService.restartArea(params.id, body);
    return { session: serializeSession(session) };
  });

  app.post('/assembly/work-sessions/:id/complete', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.complete(params.id);
    return { session: serializeSession(session) };
  });

  app.post('/assembly/work-sessions/:id/cancel', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ reason: z.string().max(500).optional().nullable() }).parse(request.body ?? {});
    const session = await sessionService.cancel(params.id, body.reason);
    return { session: serializeSession(session) };
  });

  app.get('/assembly/work-sessions/:id/export.xlsx', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const buffer = await excelService.buildSessionWorkbookBuffer(params.id);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="assembly-torque-${params.id}.xlsx"`);
    return reply.send(buffer);
  });
}
