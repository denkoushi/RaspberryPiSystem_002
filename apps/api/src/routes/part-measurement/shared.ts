import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { SelfInspectionMode } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { requireClientDevice } from '../kiosk/shared.js';
import {
  resolveTemplateFixedCount,
  serializeSelfInspectionMode,
  validateSelfInspectionConfig
} from '../../services/part-measurement/self-inspection-config.js';
import type { SelfInspectionRegistrationPolicy } from '../../services/part-measurement/self-inspection-registration-policy.service.js';
import type {
  PartMeasurementResolveService,
  PartMeasurementSheetService,
  PartMeasurementTemplateCandidateService,
  PartMeasurementTemplateService,
  PartMeasurementVisualTemplateService,
  InspectionDrawingMeasurementLabelSettingsService,
  SelfInspectionService
} from '../../services/part-measurement/index.js';
import type { SelfInspectionPaperReportIssueService } from '../../services/part-measurement/self-inspection-paper-report-issue.service.js';
import type { SelfInspectionPaperReportResolver } from '../../services/part-measurement/self-inspection-paper-report-resolver.service.js';
import type { SelfInspectionPaperOcrReviewService } from '../../services/part-measurement/self-inspection-paper-ocr-review.service.js';
import type { SelfInspectionPaperImportService } from '../../services/part-measurement/self-inspection-paper-import.service.js';
import type {
  getPartMeasurementDrawingOcrService,
  PartMeasurementDrawingOcrQueuePriority
} from '../../services/part-measurement/part-measurement-drawing-ocr.service.js';

export const processGroupSchema = z.enum(['cutting', 'grinding']);
export const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);

export const resolveTicketBodySchema = z.object({
  productNo: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  scannedFhincd: z.string().max(120).optional().nullable(),
  scannedBarcodeRaw: z.string().max(500).optional().nullable(),
  resourceCd: z.string().max(120).optional().nullable()
});

export const createSheetBodySchema = z.object({
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

export const findOrOpenSheetBodySchema = z.object({
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

export const patchSheetBodySchema = z.object({
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

export const templateItemSchema = z.object({
  sortOrder: z.number().int().min(0).max(999),
  datumSurface: z.string().min(1).max(500),
  measurementPoint: z.string().min(1).max(500),
  measurementLabel: z.string().min(1).max(500),
  displayMarker: z.string().max(40).optional().nullable(),
  unit: z.string().max(50).optional().nullable(),
  allowNegative: z.boolean().optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  markerXRatio: z.number().min(0).max(1).optional().nullable(),
  markerYRatio: z.number().min(0).max(1).optional().nullable(),
  calloutTipXRatio: z.number().min(0).max(1).optional().nullable(),
  calloutTipYRatio: z.number().min(0).max(1).optional().nullable(),
  nominalValue: z.number().optional().nullable(),
  lowerLimit: z.number().optional().nullable(),
  upperLimit: z.number().optional().nullable(),
  depthMode: z.enum(['measured', 'through']).optional().default('measured')
});

export const templateScopeSchema = z.enum(['three_key', 'fhincd_resource', 'fhinmei_only']);
export const selfInspectionModeSchema = z.enum(['full', 'single', 'first_last', 'fixed_count', 'sample']);

export function refineSelfInspectionConfig(
  val: {
    selfInspectionMode?: z.infer<typeof selfInspectionModeSchema>;
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
  },
  ctx: z.RefinementCtx
): void {
  const modeRaw = val.selfInspectionMode ?? 'full';
  const mode = modeRaw === 'sample' ? 'fixed_count' : modeRaw;
  try {
    validateSelfInspectionConfig({
      mode,
      fixedCount: val.selfInspectionFixedCount ?? val.selfInspectionSampleSize ?? null
    });
  } catch (error) {
    if (error instanceof ApiError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error.message,
        path: ['selfInspectionFixedCount']
      });
    } else {
      throw error;
    }
  }
}

/** 新規作成用: 未指定時は full */
export function selfInspectionFieldsFromBody(body: {
  selfInspectionMode?: z.infer<typeof selfInspectionModeSchema>;
  selfInspectionFixedCount?: number | null;
  selfInspectionSampleSize?: number | null;
}): { selfInspectionMode: SelfInspectionMode; selfInspectionFixedCount: number | null } {
  const modeRaw = body.selfInspectionMode ?? 'full';
  const modeDto = modeRaw === 'sample' ? 'fixed_count' : modeRaw;
  const validated = validateSelfInspectionConfig({
    mode: modeDto,
    fixedCount: body.selfInspectionFixedCount ?? body.selfInspectionSampleSize ?? null
  });
  return {
    selfInspectionMode: validated.mode,
    selfInspectionFixedCount: validated.fixedCount
  };
}

export const createTemplateBodySchema = z
  .object({
    templateScope: templateScopeSchema.optional().default('three_key'),
    fhincd: z.string().max(120),
    processGroup: processGroupSchema,
    resourceCd: z.string().max(120),
    name: z.string().min(1).max(200),
    items: z.array(templateItemSchema).min(1).max(200),
    visualTemplateId: z.string().uuid().optional().nullable(),
    candidateFhinmei: z.string().max(500).optional().nullable(),
    selfInspectionMode: selfInspectionModeSchema.optional().default('full'),
    selfInspectionFixedCount: z.number().int().min(1).max(2000).optional().nullable(),
    selfInspectionSampleSize: z.number().int().min(1).max(2000).optional().nullable(),
    failIfActiveExists: z.boolean().optional().default(false)
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
    }
    if (val.templateScope !== 'fhinmei_only') {
      if (val.fhincd.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'FIHNCD が空です', path: ['fhincd'] });
      }
      const r = val.resourceCd.trim();
      if (r.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '資源CDが空です', path: ['resourceCd'] });
      }
    }
    refineSelfInspectionConfig(val, ctx);
  });

export const inspectionDrawingTemplateResourceCdsSchema = z
  .array(z.string().min(1).max(120))
  .min(1)
  .max(50);

export const createInspectionDrawingTemplateGroupBodySchema = z
  .object({
    fhincd: z.string().min(1).max(120),
    processGroup: processGroupSchema,
    resourceCds: inspectionDrawingTemplateResourceCdsSchema,
    name: z.string().min(1).max(200),
    displayName: z.string().max(200).optional().nullable(),
    items: z.array(templateItemSchema).min(1).max(200),
    visualTemplateId: z.string().uuid(),
    selfInspectionMode: selfInspectionModeSchema.optional().default('full'),
    selfInspectionFixedCount: z.number().int().min(1).max(2000).optional().nullable(),
    selfInspectionSampleSize: z.number().int().min(1).max(2000).optional().nullable()
  })
  .superRefine((val, ctx) => {
    refineSelfInspectionConfig(val, ctx);
  });

export const addInspectionDrawingTemplateGroupResourcesBodySchema = z.object({
  resourceCds: inspectionDrawingTemplateResourceCdsSchema,
  sourceTemplateId: z.string().uuid().optional().nullable()
});

/** 検査図面 MVP: 評価用テンプレ（本番 THREE_KEY 系譜とは別バケット） */
export const createInspectionDrawingEvaluationTemplateBodySchema = z.object({
  referenceFhincd: z.string().min(1).max(120),
  referenceResourceCd: z.string().min(1).max(120),
  referenceProcessGroup: processGroupSchema,
  name: z.string().min(1).max(200),
  items: z.array(templateItemSchema).min(1).max(200),
  visualTemplateId: z.string().uuid().optional()
});

/** 有効テンプレの系譜固定での改版。FHINMEI_ONLY のときのみ candidateFhinmei を変更可 */
export const reviseTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    items: z.array(templateItemSchema).min(1).max(200),
    visualTemplateId: z.string().uuid().optional().nullable(),
    candidateFhinmei: z.string().max(500).optional().nullable(),
    selfInspectionMode: selfInspectionModeSchema.optional(),
    selfInspectionFixedCount: z.number().int().min(1).max(2000).optional().nullable(),
    selfInspectionSampleSize: z.number().int().min(1).max(2000).optional().nullable(),
    detachFromSiblingGroup: z.boolean().optional()
  })
  .superRefine((val, ctx) => {
    if (val.candidateFhinmei !== undefined && val.candidateFhinmei !== null) {
      const c = String(val.candidateFhinmei).trim();
      if (c.length > 0 && c.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FHINMEI 候補キーは 2 文字以上にしてください',
          path: ['candidateFhinmei']
        });
      }
    }
    if (val.selfInspectionMode !== undefined) {
      refineSelfInspectionConfig(val, ctx);
    }
  });

/** 候補テンプレを日程の FIHNCD+工程+資源CD 用テンプレへ複製（既存 active があれば再利用） */
export const cloneTemplateForScheduleBodySchema = z.object({
  sourceTemplateId: z.string().uuid(),
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120)
});

export const listTemplatesQuerySchema = z.object({
  fhincd: z.string().max(120).optional(),
  processGroup: processGroupSchema.optional(),
  resourceCd: z.string().max(120).optional(),
  includeInactive: z.coerce.boolean().optional()
});

/** 上部数字テンキー用。空文字はサービス層で未指定として扱う。 */
export const inspectionDrawingDigitQuerySchema = z
  .string()
  .max(200)
  .regex(/^[0-9]*$/, 'digitQuery は ASCII 数字だけで指定してください')
  .optional();

export const kioskInspectionDrawingTemplatesQuerySchema = listTemplatesQuerySchema.extend({
  /** 図面名の部分一致（大文字小文字無視）。空文字は無視 */
  visualName: z.string().max(200).optional(),
  /** 図面名から抽出した ASCII 数字列の部分一致 */
  digitQuery: inspectionDrawingDigitQuerySchema
});

export const changeInspectionDrawingTemplateProcessGroupBodySchema = z.object({
  processGroup: processGroupSchema
});

export const inspectionDrawingFhincdCandidatesQuerySchema = z.object({
  prefix: z.string().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(20).optional().default(20)
});

export const inspectionDrawingToleranceKindSchema = z.enum(['dimension', 'geometric']);

export const inspectionDrawingMeasurementLabelSettingSchema = z.object({
  label: z.string().min(1).max(120),
  toleranceKind: inspectionDrawingToleranceKindSchema
});

export const updateInspectionDrawingMeasurementLabelSettingsBodySchema = z.object({
  settings: z.array(inspectionDrawingMeasurementLabelSettingSchema).max(300)
});

/** Query string boolean: only the literal "true" (case-insensitive) is true. */
export const optionalQueryTrueOnlyBooleanSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return value.trim().toLowerCase() === 'true';
  });

export const activeTemplateExistsQuerySchema = z.object({
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120)
});

export const drawingOcrCandidateBodySchema = z.object({
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  markerNo: z.number().int().min(1).max(999).optional().nullable(),
  limit: z.number().int().min(1).max(20).optional(),
  measurementLabel: z.string().max(120).optional().nullable(),
  depthMode: z.enum(['measured', 'through']).optional().nullable()
});

export const listTemplateCandidatesQuerySchema = z.object({
  fhincd: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120),
  fhinmei: z.string().max(500).optional(),
  q: z.string().max(200).optional()
});

export const selfInspectionSessionResolveBodySchema = z.object({
  templateId: z.string().uuid(),
  productNo: z.string().min(1).max(120),
  processGroup: processGroupSchema,
  resourceCd: z.string().min(1).max(120),
  /** 互換用（無視）。実際の指示数は日程行の補助データから取得する */
  plannedQuantity: z.number().int().min(1).optional(),
  scheduleRowId: z.string().uuid(),
  fseiban: z.string().min(1).max(120),
  fhincd: z.string().min(1).max(120),
  fhinmei: z.string().min(1).max(500),
  machineName: z.string().max(500).optional().nullable()
});

export const listSelfInspectionSessionsQuerySchema = z.object({
  productNo: z.string().max(120).optional(),
  resourceCd: z.string().max(120).optional(),
  processGroup: processGroupSchema.optional(),
  status: z.enum(['not_started', 'in_progress', 'review_pending', 'completed']).optional()
});

export const getSelfInspectionSessionQuerySchema = z.object({
  entryIndex: z.coerce.number().int().min(0).optional()
});

export const selfInspectionSessionIdParamsSchema = z.object({
  id: z.string().uuid()
});

export const selfInspectionEntryIdParamsSchema = z.object({
  id: z.string().uuid(),
  entryId: z.string().uuid()
});

export const selfInspectionEntryIndexParamsSchema = z.object({
  id: z.string().uuid(),
  entryIndex: z.coerce.number().int().min(0).max(1999)
});

export const selfInspectionEntryValueSchema = z.object({
  templateItemId: z.string().uuid(),
  value: z.union([z.string(), z.number(), z.null()]),
  outOfToleranceAcknowledged: z.boolean().optional()
});

export const selfInspectionCreateEntryBodySchema = z.object({
  entryIndex: z.number().int().min(0),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  values: z.array(selfInspectionEntryValueSchema).min(1).max(200)
});

export const selfInspectionUpdateEntryBodySchema = z.object({
  ifUnmodifiedSince: z.string().min(1).max(100),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  values: z.array(selfInspectionEntryValueSchema).min(1).max(200)
});

export const selfInspectionUpsertDraftEntryBodySchema = z.object({
  entryIndex: z.number().int().min(0),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  ifUnmodifiedSince: z.string().min(1).max(100).optional().nullable(),
  values: z.array(selfInspectionEntryValueSchema).max(200).optional()
});

export const selfInspectionCreateInspectorEntryBodySchema = z.object({
  entryIndex: z.number().int().min(0),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  values: z.array(selfInspectionEntryValueSchema).min(1).max(200)
});

export const selfInspectionUpdateInspectorEntryBodySchema = z.object({
  entryIndex: z.number().int().min(0),
  ifUnmodifiedSince: z.string().min(1).max(100),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  values: z.array(selfInspectionEntryValueSchema).min(1).max(200)
});

export const selfInspectionInstrumentPreUseInspectionBodySchema = z.object({
  instrumentTagUid: z.string().min(1).max(200),
  employeeTagUid: z.string().min(1).max(200)
});

export const selfInspectionResetSessionBodySchema = z.object({
  confirmDestructiveReset: z.literal(true),
  confirmCompletedSessionReset: z.boolean(),
  requestId: z.string().min(1).max(120),
  reason: z.string().max(500).optional().nullable()
});

export const approveSelfInspectionOutOfToleranceReviewBodySchema = z.object({
  comment: z.string().max(500).optional().nullable()
});

export const selfInspectionRecordApprovalStateSchema = z.enum([
  'active',
  'input_incomplete',
  'inspector_measurement_pending',
  'registration_incomplete',
  'approvable',
  'approved'
]);

export const listSelfInspectionRecordApprovalsQuerySchema = z.object({
  productNo: z.string().max(120).optional(),
  resourceCd: z.string().max(120).optional(),
  processGroup: processGroupSchema.optional(),
  state: selfInspectionRecordApprovalStateSchema.optional()
});

export const resolveSelfInspectionRecordApprovalApproverBodySchema = z.object({
  uid: z.string().min(1).max(200)
});

export const approveSelfInspectionRecordApprovalBodySchema = z.object({
  approverEmployeeTagUid: z.string().min(1).max(200),
  comment: z.string().max(500).optional().nullable()
});

export const selfInspectionRegistrationPolicyBodySchema = z.object({
  requireMeasuringInstrumentTag: z.boolean()
});

export const issueSelfInspectionPaperReportBodySchema = z.object({
  templateId: z.string().uuid(),
  productNo: z.string().min(1).max(120),
  scheduleRowId: z.string().uuid(),
  fseiban: z.string().min(1).max(120),
  fhincd: z.string().min(1).max(120),
  fhinmei: z.string().min(1).max(500),
  resourceCd: z.string().min(1).max(120),
  machineName: z.string().max(500).optional().nullable()
});

export const selfInspectionPaperReportIdParamsSchema = z.object({
  id: z.string().uuid()
});

export const selfInspectionPaperOcrReviewIdParamsSchema = z.object({
  id: z.string().uuid()
});

export const selfInspectionPaperQrPayloadBodySchema = z.object({
  qrPayload: z.string().min(1).max(120)
});

export const selfInspectionPaperOcrValueSchema = z.object({
  entryIndex: z.number().int().min(0).max(1999),
  templateItemId: z.string().uuid(),
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1).optional().nullable()
});

export const createSelfInspectionPaperOcrReviewBodySchema = selfInspectionPaperQrPayloadBodySchema.extend({
  candidateValues: z.array(selfInspectionPaperOcrValueSchema).max(1000).default([]),
  imageStoragePath: z.string().max(1000).optional().nullable()
});

export const confirmSelfInspectionPaperOcrReviewBodySchema = z.object({
  values: z
    .array(
      selfInspectionPaperOcrValueSchema.extend({
        overwriteExisting: z.boolean().optional()
      })
    )
    .min(1)
    .max(1000),
  employeeTagUid: z.string().min(1).max(200).optional().nullable(),
  measuringInstrumentTagUid: z.string().min(1).max(200).optional().nullable(),
  confirmedByActorId: z.string().max(120).optional().nullable(),
  confirmedByActorName: z.string().max(200).optional().nullable()
});
export function decimalToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return String(value);
  }
  return String(value);
}

export function serializeTemplateItem(item: {
  id: string;
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  displayMarker?: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
  markerXRatio?: unknown;
  markerYRatio?: unknown;
  calloutTipXRatio?: unknown;
  calloutTipYRatio?: unknown;
  nominalValue?: unknown;
  lowerLimit?: unknown;
  upperLimit?: unknown;
  depthMode?: 'MEASURED' | 'THROUGH' | string | null;
}) {
  const depthModeRaw = String(item.depthMode ?? 'MEASURED').toUpperCase();
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    datumSurface: item.datumSurface,
    measurementPoint: item.measurementPoint,
    measurementLabel: item.measurementLabel,
    displayMarker: item.displayMarker ?? null,
    unit: item.unit,
    allowNegative: item.allowNegative,
    decimalPlaces: item.decimalPlaces,
    markerXRatio: decimalToString(item.markerXRatio),
    markerYRatio: decimalToString(item.markerYRatio),
    calloutTipXRatio: decimalToString(item.calloutTipXRatio),
    calloutTipYRatio: decimalToString(item.calloutTipYRatio),
    nominalValue: decimalToString(item.nominalValue),
    lowerLimit: decimalToString(item.lowerLimit),
    upperLimit: decimalToString(item.upperLimit),
    depthMode: depthModeRaw === 'THROUGH' ? 'through' : 'measured'
  };
}

export function serializeVisualTemplate(v: {
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

export function serializeDrawingOcrStatus(status: {
  id: string;
  visualTemplateId: string;
  status: string;
  ocrVersion: string;
  drawingImageFingerprint: string;
  engine: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  tokenCount: number;
  payloadBytes: number;
  queuePriority: number;
  attemptCount: number;
  failureReason: string | null;
  ocrStartedAt: string | null;
  ocrFinishedAt: string | null;
  lastQueuedAt: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
}) {
  return {
    ...status,
    status: status.status.toLowerCase()
  };
}

export function serializeDrawingOcrCandidate(candidate: {
  valueText: string;
  rawText: string;
  confidence: number | null;
  score: number;
  distanceRatio: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  passKind: 'full' | 'tile' | 'frame';
  preprocessKind: 'raw' | 'lineSuppressed' | 'boxedFrame';
  rotation: number;
}) {
  return candidate;
}

export function serializeTemplateScope(scope: string): 'three_key' | 'fhincd_resource' | 'fhinmei_only' {
  if (scope === 'FHINCD_RESOURCE') return 'fhincd_resource';
  if (scope === 'FHINMEI_ONLY') return 'fhinmei_only';
  return 'three_key';
}

export function serializeTemplateProcessGroup(
  processGroup: string
): 'cutting' | 'grinding' | null {
  if (processGroup === 'GRINDING') return 'grinding';
  if (processGroup === 'CUTTING') return 'cutting';
  return null;
}

export function serializeTemplateSiblingGroup(
  group: {
    id: string;
    displayName: string;
    fhincd: string;
    processGroup: string;
    createdAt?: Date;
    updatedAt?: Date;
  },
  activeResourceCds: string[]
) {
  return {
    id: group.id,
    displayName: group.displayName,
    fhincd: group.fhincd,
    processGroup: serializeTemplateProcessGroup(group.processGroup),
    activeResourceCds,
    createdAt: group.createdAt?.toISOString?.() ?? null,
    updatedAt: group.updatedAt?.toISOString?.() ?? null
  };
}

export function serializeTemplate(
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
    selfInspectionMode?: string;
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
    visualTemplateId?: string | null;
    visualTemplate?: Parameters<typeof serializeVisualTemplate>[0] | null;
    items?: Array<Parameters<typeof serializeTemplateItem>[0]>;
    siblingGroupId?: string | null;
    siblingGroup?: Parameters<typeof serializeTemplateSiblingGroup>[0] | null;
    siblingGroupActiveResourceCds?: string[];
  }
) {
  const activeResourceCds = t.siblingGroupActiveResourceCds ?? [];
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
    selfInspectionMode: serializeSelfInspectionMode(
      (t.selfInspectionMode ?? 'FULL') as import('@prisma/client').SelfInspectionMode
    ),
    selfInspectionFixedCount: resolveTemplateFixedCount({
      selfInspectionMode: (t.selfInspectionMode ?? 'FULL') as import('@prisma/client').SelfInspectionMode,
      selfInspectionFixedCount: t.selfInspectionFixedCount ?? null,
      selfInspectionSampleSize: t.selfInspectionSampleSize ?? null
    }),
    selfInspectionSampleSize: resolveTemplateFixedCount({
      selfInspectionMode: (t.selfInspectionMode ?? 'FULL') as import('@prisma/client').SelfInspectionMode,
      selfInspectionFixedCount: t.selfInspectionFixedCount ?? null,
      selfInspectionSampleSize: t.selfInspectionSampleSize ?? null
    }),
    visualTemplateId: t.visualTemplateId ?? null,
    visualTemplate: t.visualTemplate ? serializeVisualTemplate(t.visualTemplate) : null,
    items: (t.items ?? []).map(serializeTemplateItem),
    siblingGroupId: t.siblingGroupId ?? null,
    siblingGroup: t.siblingGroup
      ? serializeTemplateSiblingGroup(t.siblingGroup, activeResourceCds)
      : null
  };
}

export function serializeSelfInspectionPaperReportPage(page: {
  id: string;
  reportId: string;
  pageCode: string;
  pageNumber: number;
  qrPayload: string;
  entryIndexFrom: number | null;
  entryIndexTo: number | null;
  markerNoFrom: number | null;
  markerNoTo: number | null;
  createdAt: Date;
}) {
  return {
    id: page.id,
    reportId: page.reportId,
    pageCode: page.pageCode,
    pageNumber: page.pageNumber,
    qrPayload: page.qrPayload,
    entryIndexFrom: page.entryIndexFrom,
    entryIndexTo: page.entryIndexTo,
    markerNoFrom: page.markerNoFrom,
    markerNoTo: page.markerNoTo,
    createdAt: page.createdAt.toISOString()
  };
}

export function serializeSelfInspectionPaperReport(report: {
  id: string;
  sessionId: string;
  scheduleRowId: string;
  templateId: string;
  status: string;
  issuedAt: Date;
  supersededAt: Date | null;
  importedAt: Date | null;
  cancelledAt: Date | null;
  clientDeviceId: string | null;
  plannedQuantity: number;
  templateVersion: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: report.id,
    sessionId: report.sessionId,
    scheduleRowId: report.scheduleRowId,
    templateId: report.templateId,
    status: report.status,
    issuedAt: report.issuedAt.toISOString(),
    supersededAt: report.supersededAt?.toISOString() ?? null,
    importedAt: report.importedAt?.toISOString() ?? null,
    cancelledAt: report.cancelledAt?.toISOString() ?? null,
    clientDeviceId: report.clientDeviceId,
    plannedQuantity: report.plannedQuantity,
    templateVersion: report.templateVersion,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString()
  };
}

export function serializeSelfInspectionPaperReportForPrint(report: {
  id: string;
  sessionId: string;
  scheduleRowId: string;
  templateId: string;
  status: string;
  issuedAt: Date;
  supersededAt: Date | null;
  importedAt: Date | null;
  cancelledAt: Date | null;
  clientDeviceId: string | null;
  plannedQuantity: number;
  templateVersion: number;
  createdAt: Date;
  updatedAt: Date;
  template: Parameters<typeof serializeTemplate>[0];
  pages: Array<Parameters<typeof serializeSelfInspectionPaperReportPage>[0]>;
}) {
  return {
    report: {
      ...serializeSelfInspectionPaperReport(report),
      pages: report.pages.map(serializeSelfInspectionPaperReportPage)
    },
    template: serializeTemplate({
      ...report.template,
      visualTemplateId: report.template.visualTemplateId,
      visualTemplate: report.template.visualTemplate,
      items: report.template.items
    })
  };
}

export function serializeSelfInspectionPaperOcrReview(review: {
  id: string;
  reportId: string;
  pageId: string | null;
  status: string;
  qrPayload: string | null;
  imageStoragePath: string | null;
  ocrCandidateValues: unknown;
  confirmedValues: unknown;
  confirmedByActorId: string | null;
  confirmedByActorName: string | null;
  confirmedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: review.id,
    reportId: review.reportId,
    pageId: review.pageId,
    status: review.status,
    qrPayload: review.qrPayload,
    imageStoragePath: review.imageStoragePath,
    ocrCandidateValues: review.ocrCandidateValues,
    confirmedValues: review.confirmedValues,
    confirmedByActorId: review.confirmedByActorId,
    confirmedByActorName: review.confirmedByActorName,
    confirmedAt: review.confirmedAt?.toISOString() ?? null,
    failureReason: review.failureReason,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString()
  };
}

export function serializeSelfInspectionRegistrationPolicy(policy: SelfInspectionRegistrationPolicy) {
  return {
    key: policy.key,
    requireMeasuringInstrumentTag: policy.requireMeasuringInstrumentTag,
    updatedAt: policy.updatedAt?.toISOString() ?? null,
    updatedBy: policy.updatedBy
  };
}

export async function readMultipartFile(
  part: MultipartFile,
  maxBytes = PartMeasurementDrawingStorage.getMaxBytes(),
  tooLargeMessage = '図面画像が大きすぎます'
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) {
      if (typeof part.file.destroy === 'function') {
        part.file.destroy();
      }
      throw new ApiError(400, tooLargeMessage);
    }
    chunks.push(buf);
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

export function serializePartMeasurementSession(
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
export function serializeSheet(
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

export function sheetResponsePair(sheet: SheetSerializeSource) {
  return {
    sheet: serializeSheet(sheet),
    session: sheet.session ? serializePartMeasurementSession(sheet.session) : null
  };
}

export async function tryGetClientDeviceId(headers: FastifyRequest['headers']): Promise<string | undefined> {
  try {
    const { clientDevice } = await requireClientDevice(headers['x-client-key']);
    return clientDevice.id;
  } catch {
    return undefined;
  }
}
export type PartMeasurementRouteDeps = {
  allowView: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  allowWriteKiosk: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  canWrite: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveService: PartMeasurementResolveService;
  sheetService: PartMeasurementSheetService;
  templateService: PartMeasurementTemplateService;
  selfInspectionService: SelfInspectionService;
  paperReportIssueService: SelfInspectionPaperReportIssueService;
  paperReportResolver: SelfInspectionPaperReportResolver;
  paperOcrReviewService: SelfInspectionPaperOcrReviewService;
  paperImportService: SelfInspectionPaperImportService;
  templateCandidateService: PartMeasurementTemplateCandidateService;
  visualTemplateService: PartMeasurementVisualTemplateService;
  measurementLabelSettingsService: InspectionDrawingMeasurementLabelSettingsService;
  drawingOcrService: ReturnType<typeof getPartMeasurementDrawingOcrService>;
  enqueueDrawingOcrAndWake: (
    visualTemplateId: string | null | undefined,
    context: string,
    priority?: PartMeasurementDrawingOcrQueuePriority
  ) => Promise<void>;
  createInspectionDrawingEvaluationSetup: (
    templateParams: Parameters<PartMeasurementTemplateService['createInspectionDrawingEvaluationTemplate']>[0],
    clientDeviceId?: string
  ) => Promise<{
    template: Awaited<ReturnType<PartMeasurementTemplateService['createInspectionDrawingEvaluationTemplate']>>['template'];
    sheet: Awaited<ReturnType<PartMeasurementSheetService['createInspectionDrawingEvaluationDraft']>>;
  }>;
};
