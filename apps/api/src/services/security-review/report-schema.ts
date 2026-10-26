import { z } from 'zod';

export const reviewKindSchema = z.enum(['changes', 'security', 'errors']);
const bounded = (length: number) => z.string().min(1).transform(value => value.slice(0, length));
export const securityReviewFindingSchema = z.object({
  kind: reviewKindSchema,
  location: bounded(500),
  what: bounded(1000),
  whyItMatters: bounded(1000),
  severity: z.enum(['high', 'medium', 'low', 'info']),
  evidenceRef: bounded(500),
}).strict();
export const securityReviewChunkAnswerSchema = z.object({
  findings: z.array(securityReviewFindingSchema).max(20),
  refusedOrVague: z.boolean(),
}).strict();
export const securityReviewReportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['ok', 'skipped', 'partial']),
  reason: bounded(4000).optional(),
  reviewedCommits: z.object({ from: z.string().max(64), to: z.string().max(64), note: bounded(500).optional() }).strict(),
  chunks: z.array(z.object({
    id: bounded(100), kind: reviewKindSchema, refusedOrVague: z.boolean(), error: bounded(200).optional(),
  }).strict()).max(24),
  findings: z.array(securityReviewFindingSchema).max(480),
}).strict();
export type SecurityReviewFinding = z.infer<typeof securityReviewFindingSchema>;
export type SecurityReviewChunkAnswer = z.infer<typeof securityReviewChunkAnswerSchema>;
export type SecurityReviewReport = z.infer<typeof securityReviewReportSchema>;
