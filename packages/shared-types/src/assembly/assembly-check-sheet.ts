import { z } from 'zod';

import { KNOWLEDGE_POSITION_RANKS } from '../knowledge/index.js';

const cellAddress = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/);
const fieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(80),
  label: z.string().max(500),
  unit: z.string().max(40).optional()
});

export const assemblyCheckSheetItemSchema = z.object({
  groupNo: z.number().int().positive(),
  itemKey: z.string().min(1).max(80),
  sortOrder: z.number().int().nonnegative(),
  label: z.string().min(1).max(10000),
  note: z.string().max(5000).nullable(),
  inputKind: z.enum(['OK_NG', 'NUMBER', 'TEXT', 'CHOICE', 'NONE']),
  inputSpec: z.object({
    fields: z.array(fieldSchema).max(50).optional(),
    options: z.array(z.string().min(1).max(200)).max(50).optional()
  }),
  roleKeys: z.array(z.string().min(1).max(100)).max(30),
  conditionKey: z.string().min(1).max(100).nullable(),
  conditionLabel: z.string().min(1).max(2000).nullable(),
  sourceRows: z.array(z.number().int().positive().max(1048576)).min(1).max(100),
  stampCell: cellAddress,
  valueTarget: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('cell'), cell: cellAddress }),
    z.object({ mode: z.literal('inline'), cell: cellAddress, template: z.string().max(20000) })
  ]),
  warnings: z.array(z.string().max(500)).max(100)
}).superRefine((item, ctx) => {
  const fields = item.inputSpec.fields ?? [];
  if (new Set(fields.map((field) => field.key)).size !== fields.length) {
    ctx.addIssue({ code: 'custom', message: 'Field keys must be unique' });
  }
  if (['NUMBER', 'TEXT'].includes(item.inputKind) && fields.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'Input fields are required' });
  }
  if (item.inputKind === 'CHOICE' && (item.inputSpec.options?.length ?? 0) < 2) {
    ctx.addIssue({ code: 'custom', message: 'Choice options are required' });
  }
  if ((item.conditionKey === null) !== (item.conditionLabel === null)) {
    ctx.addIssue({ code: 'custom', message: 'Condition key and label must be supplied together' });
  }
});

export const assemblyCheckSheetProposalSchema = z.object({
  documentNo: z.string().max(200),
  title: z.string().min(1).max(500),
  modelCode: z.string().max(200),
  revisionLabel: z.string().max(200),
  sourceSheetName: z.string().min(1).max(31),
  headerCellMap: z.record(z.string().max(80), cellAddress),
  stampColumn: z.string().regex(/^[A-Z]{1,3}$/),
  departmentRoleMembers: z.record(z.string().max(100), z.array(z.string().guid()).max(1000)),
  groups: z.array(z.object({
    groupNo: z.number().int().positive(), label: z.string().min(1).max(2000),
    sortOrder: z.number().int().nonnegative()
  })).min(1).max(1000),
  items: z.array(assemblyCheckSheetItemSchema).min(1).max(5000)
}).superRefine((proposal, ctx) => {
  const groupNos = new Set(proposal.groups.map((group) => group.groupNo));
  if (groupNos.size !== proposal.groups.length ||
      new Set(proposal.items.map((item) => item.itemKey)).size !== proposal.items.length ||
      new Set(proposal.items.map((item) => item.stampCell)).size !== proposal.items.length ||
      proposal.items.some((item) => !groupNos.has(item.groupNo))) {
    ctx.addIssue({ code: 'custom', message: 'Groups, item keys and stamp cells must be unique and consistent' });
  }
});

export const assemblyCheckSheetSaveSchema = z.object({
  importId: z.string().guid(),
  proposal: assemblyCheckSheetProposalSchema,
  revisionRootId: z.string().guid().optional()
}).superRefine(({ proposal }, ctx) => {
  const roles = new Set(proposal.items.flatMap((item) => item.roleKeys));
  for (const role of roles) {
    if (KNOWLEDGE_POSITION_RANKS.some((rank) => rank === role)) continue;
    if (!Object.hasOwn(proposal.departmentRoleMembers, role) || !proposal.departmentRoleMembers[role].length) {
      ctx.addIssue({ code: 'custom', path: ['proposal', 'departmentRoleMembers', role], message: `部署役割「${role}」の社員を1人以上選択してください` });
    }
  }
});

export type AssemblyCheckSheetProposal = z.infer<typeof assemblyCheckSheetProposalSchema>;
export type AssemblyCheckSheetItemProposal = z.infer<typeof assemblyCheckSheetItemSchema>;
export type AssemblyCheckSheetSavePayload = z.infer<typeof assemblyCheckSheetSaveSchema>;
export type AssemblyCheckSheetImportPayload = {
  importId: string;
  sheetNames: string[];
  proposal: AssemblyCheckSheetProposal;
};
export type AssemblyCheckSheetRevisionPayload = Omit<AssemblyCheckSheetProposal, 'groups' | 'items'> & {
  id: string;
  revisionRootId: string;
  revisionNumber: number;
  isRevisionHead: boolean;
  sourceAssetId: string;
  layoutSnapshot: AssemblyCheckSheetLayout | null;
  createdByUserId: string;
  createdAt: string;
  groups: (AssemblyCheckSheetProposal['groups'][number] & { id: string })[];
  items: (AssemblyCheckSheetItemProposal & { id: string; groupId: string })[];
};

export const assemblyCheckSheetCreateSchema = z.object({
  workUnitId: z.string().guid(), revisionRootId: z.string().guid().optional()
});
export const assemblyCheckSheetActorSchema = z.object({
  nfcTagUid: z.string().trim().min(1).max(200)
});
export const assemblyCheckSheetStampSchema = assemblyCheckSheetActorSchema.extend({
  itemId: z.string().guid(), result: z.enum(['OK', 'NG']),
  values: z.record(z.string(), z.union([z.string().max(5000), z.number().finite()])).default({}),
  flagged: z.boolean().default(false), ngReason: z.string().trim().max(2000).optional()
});
export const assemblyCheckSheetConditionSchema = assemblyCheckSheetActorSchema.extend({
  conditionKey: z.string().min(1).max(100), applies: z.literal(false)
});
export type AssemblyCheckSheetStampInput = z.infer<typeof assemblyCheckSheetStampSchema>;
export type AssemblyCheckSheetActor = z.infer<typeof assemblyCheckSheetActorSchema>;
export type AssemblyCheckSheetStampPayload = {
  id: string; itemId: string; result: 'OK' | 'NG' | 'NA'; values: Record<string, string | number>;
  flagged: boolean; ngReason: string | null; employeeId: string | null;
  employeeCodeSnapshot: string; employeeNameSnapshot: string; positionNameSnapshot: string | null;
  stampedAt: string;
};
export type AssemblyCheckSheetPayload = {
  id: string; workUnitId: string; revisionId: string; status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED';
  headerValues: Record<string, string>; pausedReason: string | null; startedAt: string; completedAt: string | null;
  revision: AssemblyCheckSheetRevisionPayload; stamps: AssemblyCheckSheetStampPayload[];
};

const paperRangeSchema = z.object({
  top: z.number().int().positive(), left: z.number().int().positive(),
  bottom: z.number().int().positive(), right: z.number().int().positive()
});
const paperBorderSchema = z.enum(['thin', 'medium', 'none']);
export const assemblyCheckSheetLayoutSchema = z.object({
  range: paperRangeSchema,
  columnWidths: z.array(z.number().nonnegative()),
  rowHeights: z.array(z.number().nonnegative()),
  merges: z.array(paperRangeSchema),
  // Omitted properties use Excel defaults: 11pt, regular, left/bottom, no border/wrap.
  cells: z.record(cellAddress, z.object({
    text: z.string().optional(), fontSize: z.number().positive().optional(), bold: z.boolean().optional(),
    horizontal: z.enum(['left', 'center', 'right', 'justify']).optional(),
    vertical: z.enum(['top', 'middle', 'bottom']).optional(), wrap: z.boolean().optional(),
    borders: z.object({ left: paperBorderSchema.optional(), right: paperBorderSchema.optional(),
      top: paperBorderSchema.optional(), bottom: paperBorderSchema.optional() }).optional()
  }))
});
export const assemblyCheckSheetPaperLayoutSchema = z.object({
  layoutSnapshot: assemblyCheckSheetLayoutSchema,
  writes: z.array(z.object({ cell: cellAddress, text: z.string() })),
  stampCells: z.array(cellAddress)
});
export type AssemblyCheckSheetLayout = z.infer<typeof assemblyCheckSheetLayoutSchema>;
export type AssemblyCheckSheetPaperLayout = z.infer<typeof assemblyCheckSheetPaperLayoutSchema>;
export type AssemblyCheckSheetCellWrite = AssemblyCheckSheetPaperLayout['writes'][number];
