import { z } from 'zod';
const version = z.number().int().min(0).max(2_147_483_647);
const revision = z.string().regex(/^[0-9a-f]{64}$/);
const parentItemId = z.string().min(1).max(2000);
export const sessakuPiecesSplitSchema = z.object({
  parentItemId, targetPieceId: z.string().uuid().optional(),
  quantities: z.array(z.number().int().positive().max(2_147_483_647)).min(2).max(2000),
  expectedPieceSetVersion: version, itemRevision: revision
});
export const sessakuPiecesMergeSchema = z.object({
  parentItemId, pieceIds: z.array(z.string().uuid()).min(2).max(2000),
  expectedPieceSetVersion: version, itemRevisions: z.record(z.string().max(2000), revision)
}).refine((body) => new Set(body.pieceIds).size === body.pieceIds.length, { message: '片が重複しています' });
export const sessakuPieceCompletionSchema = z.object({
  intent: z.enum(['complete', 'incomplete']), expectedPieceSetVersion: version, itemRevision: revision
});
