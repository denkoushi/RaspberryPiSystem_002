import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { enforceReviewTier, normalizeIdentifiers } from './procedure-builder.js';
import { composeTitle, titlePartsSchema } from './procedure-content.js';
import { activeKnowledgeField, topicIdentity } from './knowledge-fields.js';
import type { TriageDestination } from './triage.port.js';

export const knowledgeDestinationSchema = z.union([
  z.object({ procedureId: z.string().uuid() }).strict(),
  z.object({ newTopic: z.object({ target: z.string(), workType: z.string(), detail: z.string().optional(),
    partNumber: z.string().optional(), drawingNumber: z.string().optional() }).strict() }).strict(),
]);

export function personDestination(raw: z.infer<typeof knowledgeDestinationSchema>): TriageDestination {
  if ('procedureId' in raw) return raw;
  const detail = raw.newTopic.detail?.trim();
  const parts = titlePartsSchema.parse({ target: raw.newTopic.target, workType: raw.newTopic.workType, ...(detail ? { detail } : {}) });
  const identifiers = normalizeIdentifiers(raw.newTopic);
  const reviewTier = enforceReviewTier({ title: composeTitle(parts), category: parts.workType, identifiers, reviewTier: 'auto_publish' }, 1);
  return { newTopic: { parts, identifiers, reviewTier } };
}

export async function validateDestination(tx: Pick<Prisma.TransactionClient, 'knowledgeProcedure' | 'knowledgeField'>, destination: TriageDestination) {
  if ('procedureId' in destination) {
    if (!await tx.knowledgeProcedure.findUnique({ where: { id: destination.procedureId } })) throw new Error('UNKNOWN_PROCEDURE_TOPIC');
    return;
  }
  await activeKnowledgeField(tx, destination.newTopic.parts.workType);
}

export async function resolveDestination(tx: Prisma.TransactionClient, destination: TriageDestination): Promise<string> {
  if ('procedureId' in destination) { await validateDestination(tx, destination); return destination.procedureId; }
  const { identifiers } = destination.newTopic;
  const { field, root } = await activeKnowledgeField(tx, destination.newTopic.parts.workType);
  const parts = { ...destination.newTopic.parts, workType: field.name };
  const key = topicIdentity(parts);
  // One lock per normalized title also covers legacy rows without an identity yet.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  const identity = await tx.knowledgeTopicIdentity.findUnique({ where: { key } });
  if (identity) return identity.procedureId;
  const existing = (await tx.knowledgeProcedure.findMany({ where: { target: { not: null }, workType: { not: null }, topicIdentity: null }, orderBy: { createdAt: 'asc' } }))
    .find(row => topicIdentity({ target: row.target!, workType: row.workType!, detail: row.detail }) === key);
  const reviewTier = enforceReviewTier({ title: composeTitle(parts), category: parts.workType, identifiers, reviewTier: destination.newTopic.reviewTier }, 1, root.name);
  const topic = existing ?? await tx.knowledgeProcedure.create({ data: {
    id: randomUUID(), title: composeTitle(parts), category: parts.workType, target: parts.target, workType: parts.workType, detail: parts.detail ?? null,
    fieldId: field.id, reviewTier, partNumber: identifiers.partNumber ?? null, drawingNumber: identifiers.drawingNumber ?? null, processName: identifiers.processName ?? null,
  } });
  await tx.knowledgeTopicIdentity.create({ data: { key, procedureId: topic.id } });
  return topic.id;
}
