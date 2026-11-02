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
  vagueReason: bounded(200).optional(),
}).strict();
const deviceFields = { clientId: bounded(200), device: bounded(500) };
const storageAlertSchema = z.object({
  ...deviceFields, signal: bounded(200), severity: bounded(100).nullable(), timestamp: bounded(100),
}).strict();
export const deviceHealthSchema = z.object({
  attention: z.enum(['storage', 'power', 'offline', 'none']),
  storage: z.object({ open: z.array(storageAlertSchema).max(100), last24h: z.array(storageAlertSchema).max(100) }).strict(),
  ext4Errors: z.array(z.object({
    ...deviceFields, count: z.number().int().positive(), observedAt: bounded(100),
  }).strict()).max(100),
  power: z.array(z.object({
    ...deviceFields, signal: bounded(200), count: z.number().int().positive(),
    first: bounded(100), last: bounded(100), raw: z.string().max(500),
  }).strict()).max(100),
  offline: z.array(z.object({
    ...deviceFields, lastSeen: bounded(100), detectedAt: bounded(100), endedAt: bounded(100).nullable(),
  }).strict()).max(100),
  unavailable: z.literal(true).optional(),
}).strict();
export const securityReviewReportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['ok', 'skipped', 'partial']),
  deviceHealth: deviceHealthSchema.optional(),
  reason: bounded(4000).optional(),
  reviewedCommits: z.object({ from: z.string().max(64), to: z.string().max(64), note: bounded(500).optional() }).strict(),
  chunks: z.array(z.object({
    id: bounded(100), kind: reviewKindSchema, refusedOrVague: z.boolean(), error: bounded(200).optional(),
  }).strict()),
  findings: z.array(securityReviewFindingSchema).max(10000),
  changeQueue: z.object({ reviewedCommits: z.number().int().nonnegative(), pending: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(), invalid: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    oldestPendingCommittedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict().optional(),
}).strict();
export type SecurityReviewFinding = z.infer<typeof securityReviewFindingSchema>;
export type SecurityReviewChunkAnswer = z.infer<typeof securityReviewChunkAnswerSchema>;
export type SecurityReviewReport = z.infer<typeof securityReviewReportSchema>;
export type DeviceHealth = z.infer<typeof deviceHealthSchema>;
