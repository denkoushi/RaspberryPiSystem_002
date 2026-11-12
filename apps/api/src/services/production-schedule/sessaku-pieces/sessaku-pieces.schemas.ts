import { resourceCdSchema } from '../grinding-planning-board-resource-capacity.service.js';
import { resourcePartMinutesExpectedSchema } from '../grinding-planning-board-resource-minutes.service.js';
import { grindingPlanningBoardDueSourceSchema } from '../grinding-planning-board/shared.js';
import { z } from 'zod';
const version = z.number().int().min(0).max(2_147_483_647);
const revision = z.string().regex(/^[0-9a-f]{64}$/);
const parentItemId = z.string().min(1).max(2000);
const pieceItemId = z.string().max(2000).refine((value) => {
  const match = /^(?:piece:([^:]+)|pieceops:([^:]+):([1-9]|1[0-9]|20))$/.exec(value);
  return match != null && z.string().uuid().safeParse(match[1] ?? match[2]).success;
}, { message: '対象アイテムIDが不正です' });
export const sessakuPiecesSplitSchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  parentItemId, targetPieceId: z.string().uuid().optional(),
  quantities: z.array(z.number().int().positive().max(2_147_483_647)).min(2).max(2000),
  expectedPieceSetVersion: version, itemRevision: revision
});
export const sessakuPiecesMergeSchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  parentItemId, pieceIds: z.array(z.string().uuid()).min(2).max(2000),
  expectedPieceSetVersion: version, itemRevisions: z.record(z.string().max(2000), revision)
}).refine((body) => new Set(body.pieceIds).size === body.pieceIds.length, { message: '片が重複しています' });
export const sessakuPieceCompletionSchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  itemId: pieceItemId.optional(),
  intent: z.enum(['complete', 'incomplete']), expectedPieceSetVersion: version, itemRevision: revision
});
export const sessakuPieceOpsSplitSchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  itemId: pieceItemId, fromOpNo: z.number().int().min(1).max(20),
  expectedPieceSetVersion: version, itemRevision: revision
});
export const sessakuPieceOpsMergeSchema = sessakuPieceOpsSplitSchema.omit({ fromOpNo: true });

export const sessakuPieceOpsConfigureSchema = sessakuPieceOpsMergeSchema.extend({
  resourceCd: resourceCdSchema,
  minutes: z.array(z.number().finite().positive().max(100000).multipleOf(0.5)).min(1).max(6)
    .refine((values) => values.reduce((sum, value) => sum + value, 0) <= 100000),
  expectedOpIds: z.array(z.string()).max(20),
  expectedMinutes: resourcePartMinutesExpectedSchema
});
export const sessakuPieceOpsClearSchema = sessakuPieceOpsMergeSchema.extend({ scope: z.enum(['piece', 'set']) });
