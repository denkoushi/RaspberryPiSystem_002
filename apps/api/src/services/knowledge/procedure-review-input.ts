import { z } from 'zod';

import { KNOWLEDGE_POSITION_RANKS } from './knowledge-position-rank.js';

const tagUid = z.string().trim().min(1).max(128);
export const reviewCommentSchema = z.string().trim().min(1).max(500);
export const reviewRequestSchema = z.object({ reviewerTagUid: tagUid }).strict();
export const approveRequestSchema = reviewRequestSchema.extend({ comment: reviewCommentSchema.optional() }).strict();
export const returnRequestSchema = reviewRequestSchema.extend({ comment: reviewCommentSchema }).strict();
export const errorReportRequestSchema = z.object({ reporterTagUid: tagUid, comment: reviewCommentSchema }).strict();
export const positionRanksRequestSchema = z.object({ ranks: z.array(z.object({
  positionName: z.string().trim().min(1).max(200), rank: z.enum(KNOWLEDGE_POSITION_RANKS),
}).strict()).max(200).refine(rows => new Set(rows.map(row => row.positionName)).size === rows.length, '職位名が重複しています。') }).strict();
