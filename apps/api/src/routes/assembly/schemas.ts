import { z } from 'zod';
import { TORQUE_INPUT_PORT_SOURCES } from '../../services/assembly/index.js';

export const optionalTrueOnlyBooleanSchema = z
  .union([z.literal('true'), z.literal(true)])
  .optional()
  .transform((value) => value === true || value === 'true');

export const idParamSchema = z.object({ id: z.string().uuid() });
export const machineNameCandidatesQuerySchema = z.object({
  digitQuery: z.string().regex(/^[0-9]*$/, 'digitQueryは半角数字のみ指定できます').max(120).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function validateCalloutTipPair(
  value: { calloutTipXRatio?: number | null; calloutTipYRatio?: number | null },
  ctx: z.RefinementCtx
): void {
  const bothOmitted = value.calloutTipXRatio === undefined && value.calloutTipYRatio === undefined;
  const bothNull = value.calloutTipXRatio === null && value.calloutTipYRatio === null;
  const bothNumbers =
    typeof value.calloutTipXRatio === 'number' && typeof value.calloutTipYRatio === 'number';
  if (!bothOmitted && !bothNull && !bothNumbers) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '矢視先端座標はX/Yを両方指定してください',
      path: ['calloutTipXRatio']
    });
  }
}

const boltInputSchema = z.object({
  sortOrder: z.coerce.number().int().min(0),
  tighteningId: z.string().trim().min(1).max(120).optional(),
  markerNo: z.coerce.number().int().min(1).max(999),
  xRatio: z.coerce.number().min(0).max(1),
  yRatio: z.coerce.number().min(0).max(1),
  calloutTipXRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  calloutTipYRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  boltSpec: z.string().trim().min(1).max(200),
  nominalDiameter: z.string().trim().min(1).max(40).optional().nullable(),
  boltLengthMm: z.coerce.number().positive().optional().nullable(),
  material: z.string().trim().min(1).max(80).optional().nullable(),
  strengthClass: z.string().trim().min(1).max(80).optional().nullable(),
  capabilityGroupId: z.string().uuid().optional().nullable(),
  nominalTorque: z.coerce.number(),
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  unit: z.string().trim().min(1).max(40),
  kioskDocumentId: z.string().uuid().optional().nullable(),
  assemblyProcedureDocumentId: z.string().uuid().optional().nullable(),
  pageIndex: z.coerce.number().int().min(0).optional().nullable()
}).superRefine(validateCalloutTipPair);

const checkItemInputSchema = z.object({
  markerNo: z.coerce.number().int().min(1).max(999),
  label: z.string().trim().max(200).optional().nullable(),
  required: z.boolean().optional(),
  xRatio: z.coerce.number().min(0).max(1),
  yRatio: z.coerce.number().min(0).max(1),
  calloutTipXRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  calloutTipYRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0),
  kioskDocumentId: z.string().uuid().optional().nullable(),
  assemblyProcedureDocumentId: z.string().uuid().optional().nullable(),
  pageIndex: z.coerce.number().int().min(0).optional()
}).superRefine(validateCalloutTipPair);

const areaInputSchema = z.object({
  sortOrder: z.coerce.number().int().min(0),
  processNo: z.string().trim().max(80),
  areaCode: z.string().trim().max(80),
  areaName: z.string().trim().max(200),
  unitCode: z.string().trim().max(80),
  requireManualAdvance: z.boolean().optional(),
  bolts: z.array(boltInputSchema).min(1)
});

const documentSequenceItemBodySchema = z
  .object({
    kioskDocumentId: z.string().uuid().optional().nullable(),
    assemblyProcedureDocumentId: z.string().uuid().optional().nullable(),
    label: z.string().trim().max(120).optional().nullable()
  })
  .superRefine((item, ctx) => {
    const hasKiosk = Boolean(item.kioskDocumentId);
    const hasAssembly = Boolean(item.assemblyProcedureDocumentId);
    if (hasKiosk === hasAssembly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '要領書PDFまたは組立手順書のどちらか一方を指定してください'
      });
    }
  });

const procedureStepBodySchema = z.object({
  kioskDocumentId: z.string().uuid().optional().nullable(),
  assemblyProcedureDocumentId: z.string().uuid().optional().nullable(),
  pageIndex: z.coerce.number().int().min(0),
  viewMode: z
    .enum(['full_page', 'crop'])
    .transform((value) => (value === 'crop' ? 'CROP' : 'FULL_PAGE') as 'CROP' | 'FULL_PAGE'),
  cropXRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  cropYRatio: z.coerce.number().min(0).max(1).optional().nullable(),
  cropWidthRatio: z.coerce.number().min(0.02).max(1).optional().nullable(),
  cropHeightRatio: z.coerce.number().min(0.02).max(1).optional().nullable(),
  title: z.string().trim().max(120).optional().nullable(),
  instructionText: z.string().trim().max(1000).optional().nullable(),
  emphasis: z
    .enum(['normal', 'important', 'caution'])
    .optional()
    .transform((value) => (value?.toUpperCase() ?? 'NORMAL') as 'NORMAL' | 'IMPORTANT' | 'CAUTION')
});

export const templateBodySchema = z.object({
  modelCode: z.string().trim().min(1).max(120),
  procedurePattern: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  procedureDocumentId: z.string().uuid(),
  areas: z.array(areaInputSchema).min(1),
  checkItems: z.array(checkItemInputSchema).optional(),
  traceabilityMode: z.enum(['LEGACY', 'REQUIRED']).optional().default('LEGACY'),
  procedureItems: z.array(documentSequenceItemBodySchema).min(1).max(50).optional(),
  procedureSteps: z.array(procedureStepBodySchema).min(1).max(300).optional(),
  accessPassword: z.string().max(128).optional()
});

export const templateReviseBodySchema = templateBodySchema.partial().extend({
  areas: z.array(areaInputSchema).min(1).optional(),
  checkItems: z.array(checkItemInputSchema).optional(),
  procedureItems: z.array(documentSequenceItemBodySchema).min(1).max(50).optional(),
  procedureSteps: z.array(procedureStepBodySchema).min(1).max(300).optional()
});

export const recordCheckBodySchema = z.object({
  checkItemId: z.string().uuid(),
  checked: z.boolean()
});

export const startSessionBodySchema = z
  .object({
  templateId: z.string().uuid(),
  productNo: z.string().trim().min(1).max(120),
  workId: z.string().trim().min(1).max(120).optional(),
  /** 旧クライアント互換。新規クライアントは workId を送信する。 */
  serialNo: z.string().trim().min(1).max(120).optional(),
  nameplateNo: z.string().trim().min(1).max(120).optional().nullable(),
  operatorNfcTagUid: z.string().trim().min(1).max(200),
  requestId: z.string().uuid(),
  targetUnit: z.string().trim().min(1).max(120),
  torqueWrenchId: z.string().trim().min(1).max(120).optional().nullable()
  })
  .superRefine((value, ctx) => {
    if (!value.workId && !value.serialNo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '作業用IDが必要です', path: ['workId'] });
    }
    if (value.workId && value.serialNo && value.workId !== value.serialNo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workId と serialNo は同じ値を指定してください', path: ['workId'] });
    }
  });

export const createAssemblyLotBodySchema = z
  .object({
  templateId: z.string().uuid(),
  productNo: z.string().trim().min(1).max(120),
  expectedQuantity: z.coerce.number().int().min(1).max(500),
  workIdMode: z.enum(['auto', 'manual']).optional(),
  workIds: z.array(z.string().trim().min(1).max(120)).min(1).max(500).optional(),
  /** 旧クライアント互換。新規クライアントは workIds を送信する。 */
  serialNos: z.array(z.string().trim().min(1).max(120)).min(1).max(500).optional(),
  operatorEmployeeId: z.string().trim().max(120).optional().nullable(),
  operatorNameSnapshot: z.string().trim().min(1).max(120).optional().nullable(),
  targetUnit: z.string().trim().min(1).max(120),
  torqueWrenchId: z.string().trim().min(1).max(120).optional().nullable()
  })
  .superRefine((value, ctx) => {
    if (value.workIdMode === 'auto' && (value.workIds || value.serialNos)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '自動発行時は作業用IDを指定しないでください', path: ['workIds'] });
    }
    if (value.workIdMode !== 'auto' && !value.workIds && !value.serialNos) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '作業用IDが必要です', path: ['workIds'] });
    }
    if (value.workIds && value.serialNos) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workIds または serialNos のどちらか一方だけを指定してください', path: ['workIds'] });
    }
  });

export const recordTorqueBodySchema = z.object({
  value: z.coerce.number(),
  source: z.enum(TORQUE_INPUT_PORT_SOURCES).default('manual'),
  rawPayload: z.unknown().optional()
});

export const approveAssemblyRecordApprovalBodySchema = z.object({
  approverEmployeeTagUid: z.string().min(1).max(200),
  comment: z.string().max(500).optional().nullable()
});

export const lotSerialParamsSchema = z.object({
  lotId: z.string().uuid(),
  lotSerialId: z.string().uuid()
});

export const operatorAccessBodySchema = z.object({
  operatorNfcTagUid: z.string().trim().min(1).max(200),
  requestId: z.string().uuid()
});

export const invalidateAssemblyWorkUnitBodySchema = z.object({
  accessPassword: z.string().max(128),
  reason: z.string().trim().min(1).max(500),
  requestId: z.string().uuid()
});
