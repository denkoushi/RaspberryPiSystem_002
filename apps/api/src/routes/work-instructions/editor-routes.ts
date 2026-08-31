import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { WorkInstructionEditingError, type WorkInstructionOverlayElementInput } from '../../services/work-instructions/domain/editing.js';
import type { WorkInstructionEditService } from '../../services/work-instructions/work-instruction-edit.service.js';
import type { WorkInstructionReadService } from '../../services/work-instructions/work-instruction-read.service.js';
import {
  toEditAssetDto,
  toEditRevisionDto,
  toEditingViewDto,
  toEditorGroupDto,
  toSourceVersionDto
} from './dto.js';

const accessPasswordSchema = z.string().max(128).default('');
const revisionIdParamsSchema = z.object({ revisionId: z.string().uuid() });
const rowIdParamsSchema = z.object({ rowId: z.string().uuid() });
const sourceVersionParamsSchema = z.object({ versionId: z.string().uuid() });
const sourceAssetParamsSchema = z.object({ versionId: z.string().uuid(), assetId: z.string().uuid() });
const bboxSchema = z.object({
  xRatio: z.number().finite().min(0).max(1),
  yRatio: z.number().finite().min(0).max(1),
  widthRatio: z.number().finite().gt(0).max(1),
  heightRatio: z.number().finite().gt(0).max(1)
}).refine((bbox) => bbox.xRatio + bbox.widthRatio <= 1 && bbox.yRatio + bbox.heightRatio <= 1, 'bboxが画像範囲外です');
const pointSchema = z.object({ xRatio: z.number().finite().min(0).max(1), yRatio: z.number().finite().min(0).max(1) });
const overlayBaseSchema = z.object({
  id: z.string().max(120).optional(),
  sourceStep: z.number().int().positive().nullable().optional(),
  stepKey: z.string().trim().min(1).max(500).optional(),
  pageIndex: z.number().int().min(0).optional(),
  migratedFromStep: z.number().int().positive().optional(),
  baseStepFingerprint: z.string().max(128).optional(),
  targetStepFingerprint: z.string().max(128).nullable().optional(),
  migrationState: z.enum(['MIGRATED', 'NEEDS_REVIEW', 'UNASSIGNED', 'SKIPPED']).optional(),
  bbox: bboxSchema,
  zIndex: z.number().int().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  mask: z.object({ enabled: z.boolean(), color: z.string().max(40) }).optional()
});
const overlayElementSchema = z.discriminatedUnion('kind', [
  overlayBaseSchema.extend({ kind: z.literal('TEXT'), text: z.string().max(10_000), style: z.record(z.unknown()).optional() }),
  overlayBaseSchema.extend({ kind: z.literal('IMAGE'), assetId: z.string().min(1).max(120), objectFit: z.enum(['contain', 'cover', 'fill']).optional() }),
  overlayBaseSchema.extend({
    kind: z.literal('SHAPE'),
    shape: z.enum(['RECTANGLE', 'ELLIPSE', 'LINE', 'ARROW']),
    strokeColor: z.string().max(80).optional(),
    fillColor: z.string().max(80).optional(),
    strokeWidthRatio: z.number().finite().positive().optional(),
    start: pointSchema.optional(),
    end: pointSchema.optional()
  })
]);
const saveOverlaysBodySchema = z.object({
  accessPassword: accessPasswordSchema,
  expectedEditVersion: z.coerce.number().int().min(0),
  expectedSourceVersionId: z.string().uuid(),
  expectedContentHash: z.string().min(1).max(128),
  elements: z.array(overlayElementSchema).max(10_000)
});
const createDraftBodySchema = z.object({
  accessPassword: accessPasswordSchema,
  sourceVersionId: z.string().uuid().optional(),
  copyFromRevisionId: z.string().uuid().optional()
});
const discardBodySchema = z.object({ accessPassword: accessPasswordSchema, expectedEditVersion: z.coerce.number().int().min(0).optional() });
const publishBodySchema = z.object({
  accessPassword: accessPasswordSchema,
  expectedEditVersion: z.coerce.number().int().min(0),
  expectedSourceVersionId: z.string().uuid(),
  expectedContentHash: z.string().min(1).max(128),
  confirmUnassigned: z.boolean().optional()
});
const groupPublishBodySchema = z.object({
  partNumber: z.string().trim().min(1),
  shootingTarget: z.string().trim().min(1),
  accessPassword: accessPasswordSchema,
  revisionIds: z.array(z.string().uuid()).min(1).max(500),
  expectedEditVersions: z.record(z.coerce.number().int().min(0)),
  confirmUnassigned: z.boolean().optional()
});
const regionBodySchema = z.object({ accessPassword: accessPasswordSchema, stepKey: z.string().trim().min(1).max(500), bbox: bboxSchema });
const bulkDeleteBodySchema = z.object({ requestedBy: z.string().trim().min(1).max(200).optional() }).default({});

function mapEditingError(error: unknown): never {
  if (error instanceof WorkInstructionEditingError) {
    throw new ApiError(error.statusCode, error.message, error.details, error.code);
  }
  throw error;
}

async function mapEditing<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return mapEditingError(error);
  }
}

async function canonicalRevisionDto(
  editing: WorkInstructionEditService,
  revision: Parameters<typeof toEditRevisionDto>[0]['revision']
) {
  const context = await editing.readRevisionContext(revision.id);
  if (!context) throw new ApiError(404, '作業要領改版が見つかりません', undefined, 'WORK_INSTRUCTION_REVISION_NOT_FOUND');
  return toEditRevisionDto(context);
}

async function readMultipartFile(request: FastifyRequest): Promise<{ bytes: Buffer; contentType: string; accessPassword: string }> {
  if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
  let bytes: Buffer | null = null;
  let contentType = '';
  let accessPassword = '';
  for await (const part of request.parts()) {
    if (part.type === 'file' && part.fieldname === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      bytes = Buffer.concat(chunks);
      contentType = part.mimetype;
    } else if (part.type === 'field' && part.fieldname === 'accessPassword') {
      accessPassword = String(part.value ?? '');
    }
  }
  if (!bytes) throw new ApiError(400, 'overlay画像fileが必要です');
  return { bytes, contentType, accessPassword };
}

async function buildEditorGroup(
  read: WorkInstructionReadService,
  editing: WorkInstructionEditService,
  input: { partNumber: string; shootingTarget: string }
) {
  const [latestRows, publishedGroup] = await Promise.all([
    read.readRows({ partNumber: input.partNumber, shootingTarget: input.shootingTarget, includeUnclassified: false, limit: 500, offset: 0 }),
    read.readPublishedGroup(input)
  ]);
  const rowsById = new Map(latestRows.map((row) => [row.id, row]));
  for (const row of publishedGroup?.rows ?? []) if (!rowsById.has(row.id)) rowsById.set(row.id, row);
  const editorRows = [];
  for (const row of rowsById.values()) {
    // eslint-disable-next-line no-await-in-loop
    const view = await editing.readEditingView(row.id);
    if (!view) continue;
    // eslint-disable-next-line no-await-in-loop
    const versions = await editing.listSourceVersions(row.id);
    const latestRevisionNumber = Math.max(1, versions.findIndex((version) => version.id === view.latestVersion.id) + 1);
    const publishedRevisionNumber = Math.max(1, versions.findIndex((version) => version.id === view.publishedVersion.id) + 1);
    editorRows.push({ source: row.source, editing: view, sourceVersions: versions, latestRevisionNumber, publishedRevisionNumber });
  }
  return toEditorGroupDto({ partNumber: input.partNumber, shootingTarget: input.shootingTarget, rows: editorRows });
}

export type WorkInstructionEditorRouteOptions = {
  read: WorkInstructionReadService;
  editing: WorkInstructionEditService;
  allowView: preHandlerHookHandler;
  allowWrite: preHandlerHookHandler;
  allowAdmin: preHandlerHookHandler;
};

export function registerWorkInstructionEditorRoutes(
  app: FastifyInstance,
  options: WorkInstructionEditorRouteOptions
): void {
  const { read, editing, allowView, allowWrite, allowAdmin } = options;

  app.get('/work-instructions/rows/:rowId/editing', { preHandler: [allowView] }, async (request) => {
    const { rowId } = rowIdParamsSchema.parse(request.params);
    const view = await mapEditing(() => editing.readEditingView(rowId));
    if (!view) throw new ApiError(404, '作業要領が見つかりません', undefined, 'WORK_INSTRUCTION_ROW_NOT_FOUND');
    return toEditingViewDto(view);
  });

  app.get('/work-instructions/rows/:rowId/versions', { preHandler: [allowView] }, async (request) => {
    const { rowId } = rowIdParamsSchema.parse(request.params);
    const versions = await mapEditing(() => editing.listSourceVersions(rowId));
    return { versions: versions.map(toSourceVersionDto) };
  });

  app.get('/work-instructions/editor-group', { preHandler: [allowView] }, async (request) => {
    const query = z.object({ partNumber: z.string().trim().min(1), resource: z.string().trim().min(1) }).parse(request.query ?? {});
    return mapEditing(() => buildEditorGroup(read, editing, { partNumber: query.partNumber, shootingTarget: query.resource }));
  });

  app.get('/work-instructions/editor-revisions/history', { preHandler: [allowView] }, async (request) => {
    const query = z.object({ partNumber: z.string().trim().min(1), resource: z.string().trim().min(1) }).parse(request.query ?? {});
    const group = await mapEditing(() => buildEditorGroup(read, editing, { partNumber: query.partNumber, shootingTarget: query.resource }));
    return { history: group.history };
  });

  app.post('/work-instructions/rows/:rowId/revisions', { preHandler: [allowWrite] }, async (request) => {
    const { rowId } = rowIdParamsSchema.parse(request.params);
    const body = createDraftBodySchema.parse(request.body ?? {});
    const result = await mapEditing(() => editing.createDraftRevision({ rowId, ...body }));
    return { revision: await canonicalRevisionDto(editing, result.revision), copy: result.copy };
  });

  app.post('/work-instructions/editor-revisions/copy', { preHandler: [allowWrite] }, async (request) => {
    const body = z.object({
      partNumber: z.string().trim().min(1),
      shootingTarget: z.string().trim().min(1),
      rows: z.array(z.object({ rowId: z.string().uuid(), publishedSourceVersionId: z.string().uuid(), latestSourceVersionId: z.string().uuid() })).min(1).max(500),
      accessPassword: accessPasswordSchema
    }).parse(request.body ?? {});
    const copied = await mapEditing(() => editing.createDraftRevisionGroup({
      accessPassword: body.accessPassword,
      partNumber: body.partNumber,
      shootingTarget: body.shootingTarget,
      rows: body.rows.map((row) => ({
        rowId: row.rowId,
        sourceVersionId: row.latestSourceVersionId,
        expectedPublishedVersionId: row.publishedSourceVersionId,
        expectedLatestVersionId: row.latestSourceVersionId
      }))
    }));
    const group = await mapEditing(() => buildEditorGroup(read, editing, { partNumber: body.partNumber, shootingTarget: body.shootingTarget }));
    const revisions = await Promise.all(copied.map((result) => canonicalRevisionDto(editing, result.revision)));
    return { group, revisions };
  });

  const saveRevision = async (request: FastifyRequest) => {
    const { revisionId } = revisionIdParamsSchema.parse(request.params);
    const body = saveOverlaysBodySchema.parse(request.body ?? {});
    return editing.saveOverlays({
      revisionId,
      accessPassword: body.accessPassword,
      expectedEditVersion: body.expectedEditVersion,
      expectedSourceVersionId: body.expectedSourceVersionId,
      expectedContentHash: body.expectedContentHash,
      elements: body.elements.map((element) => {
        if (element.sourceStep !== undefined) return element;
        const stepKey = 'stepKey' in element ? element.stepKey : undefined;
        const sourceStep = stepKey ? Number(stepKey.split(':').at(-1)) : undefined;
        if (typeof sourceStep !== 'number' || !Number.isSafeInteger(sourceStep) || sourceStep <= 0) {
          throw new ApiError(400, 'overlayの手順識別子が必要です', undefined, 'WORK_INSTRUCTION_STEP_KEY_REQUIRED');
        }
        return { ...element, sourceStep, migratedFromStep: element.migratedFromStep ?? sourceStep };
      }) as unknown as ReadonlyArray<WorkInstructionOverlayElementInput>
    });
  };
  for (const path of ['/work-instructions/revisions/:revisionId/overlays', '/work-instructions/editor-revisions/:revisionId/overlays']) {
    app.put(path, { preHandler: [allowWrite] }, async (request) => {
      const revision = await mapEditing(() => saveRevision(request));
      return { revision: await canonicalRevisionDto(editing, revision) };
    });
  }

  app.post('/work-instructions/revisions/:revisionId/publish', { preHandler: [allowWrite] }, async (request) => {
    const { revisionId } = revisionIdParamsSchema.parse(request.params);
    const body = publishBodySchema.parse(request.body ?? {});
    const result = await mapEditing(() => editing.publishRevision({ revisionId, ...body }));
    return { revision: await canonicalRevisionDto(editing, result.revision), migration: result.migration };
  });

  app.post('/work-instructions/editor-revisions/publish', { preHandler: [allowWrite] }, async (request) => {
    const body = groupPublishBodySchema.parse(request.body ?? {});
    const results = await mapEditing(() => editing.publishRevisionGroup({
      accessPassword: body.accessPassword,
      partNumber: body.partNumber,
      shootingTarget: body.shootingTarget,
      revisions: body.revisionIds.map((revisionId) => ({ revisionId, expectedEditVersion: body.expectedEditVersions[revisionId] ?? -1, confirmUnassigned: body.confirmUnassigned }))
    }));
    const group = await mapEditing(() => buildEditorGroup(read, editing, { partNumber: body.partNumber, shootingTarget: body.shootingTarget }));
    const revisions = await Promise.all(results.map(async (result) => ({
      revision: await canonicalRevisionDto(editing, result.revision),
      migration: result.migration
    })));
    return { group, revisions };
  });

  const discardRevision = async (request: FastifyRequest) => {
    const { revisionId } = revisionIdParamsSchema.parse(request.params);
    const body = discardBodySchema.parse(request.body ?? {});
    return editing.discardRevision({ revisionId, accessPassword: body.accessPassword, expectedEditVersion: body.expectedEditVersion });
  };
  for (const path of ['/work-instructions/revisions/:revisionId/discard', '/work-instructions/editor-revisions/:revisionId/discard']) {
    app.post(path, { preHandler: [allowWrite] }, async (request) => {
      const revision = await mapEditing(() => discardRevision(request));
      return { revision: await canonicalRevisionDto(editing, revision) };
    });
  }

  for (const path of ['/work-instructions/revisions/:revisionId/regions/image', '/work-instructions/editor-revisions/:revisionId/regions/image']) {
    app.post(path, { preHandler: [allowWrite] }, async (request) => {
      const { revisionId } = revisionIdParamsSchema.parse(request.params);
      const body = regionBodySchema.parse(request.body ?? {});
      const asset = await mapEditing(() => editing.createImageRegion({ revisionId, ...body }));
      return { asset: toEditAssetDto(asset) };
    });
  }
  for (const path of ['/work-instructions/revisions/:revisionId/regions/text', '/work-instructions/editor-revisions/:revisionId/regions/text']) {
    app.post(path, { preHandler: [allowWrite] }, async (request) => {
      const { revisionId } = revisionIdParamsSchema.parse(request.params);
      const body = regionBodySchema.parse(request.body ?? {});
      return { candidates: await mapEditing(() => editing.findTextCandidates({ revisionId, ...body })) };
    });
  }

  const uploadAsset = async (request: FastifyRequest) => {
    const { revisionId } = revisionIdParamsSchema.parse(request.params);
    const multipart = await readMultipartFile(request);
    return editing.uploadEditAsset({ revisionId, bytes: multipart.bytes, mimeType: multipart.contentType, accessPassword: multipart.accessPassword });
  };
  for (const path of ['/work-instructions/revisions/:revisionId/assets', '/work-instructions/editor-revisions/:revisionId/assets']) {
    app.post(path, { preHandler: [allowWrite] }, async (request) => ({ asset: toEditAssetDto(await mapEditing(() => uploadAsset(request))) }));
  }

  app.get('/work-instructions/edit-assets/:id', { preHandler: [allowView] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await mapEditing(() => editing.readEditAsset(id));
    if (!result) throw new ApiError(404, '編集画像が見つかりません', undefined, 'WORK_INSTRUCTION_EDIT_ASSET_NOT_FOUND');
    reply.header('Content-Type', result.asset.mimeType);
    reply.header('Content-Length', String(result.bytes.length));
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(result.bytes);
  });

  app.delete('/work-instructions/source-versions/:versionId/image', { preHandler: [allowAdmin] }, async (request) => {
    const { versionId } = sourceVersionParamsSchema.parse(request.params);
    const body = bulkDeleteBodySchema.parse(request.body ?? {});
    const results = await mapEditing(() => editing.deleteSourceVersionImages({ sourceVersionId: versionId, requestedBy: request.user?.username ?? body.requestedBy ?? 'admin' }));
    const deletedCount = results.filter((result) => result.status === 'DELETED').length;
    return { results, deletedCount, deletedImageCount: deletedCount, failedCount: results.filter((result) => result.status === 'FAILED').length };
  });

  app.delete('/work-instructions/source-versions/:versionId/assets/:assetId', { preHandler: [allowAdmin] }, async (request) => {
    const params = sourceAssetParamsSchema.parse(request.params);
    const body = bulkDeleteBodySchema.parse(request.body ?? {});
    return mapEditing(() => editing.deleteSourceAsset({ sourceVersionId: params.versionId, assetId: params.assetId, requestedBy: request.user?.username ?? body.requestedBy ?? 'admin' }));
  });
}
