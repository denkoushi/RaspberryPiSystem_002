import type { Prisma, PrismaClient } from '@prisma/client';
import { EXPERIENCE_KIND, experienceSchema, type BusinessHermesAnswerCache } from './business-hermes-answer-cache.js';
import { assertConsultationWritable, type BusinessHermesConsultationCaller } from './business-hermes-consultation-owner.js';

export async function recordConsultationFeedback(db: PrismaClient,
  answerCache: Partial<Pick<BusinessHermesAnswerCache, 'remember' | 'feedback'>>,
  consultationId: string, messageId: string, verdict: 'helpful' | 'unhelpful', caller: BusinessHermesConsultationCaller): Promise<boolean> {
  if (!await assertConsultationWritable(db, consultationId, caller)) return false;
  // Resolve all content server-side under the same business authorization as chat.
  const message = await db.businessHermesConsultationMessage.findFirst({ where: { id: messageId, consultationId, role: 'assistant' } });
  if (!message) return false;
  const diagnostics = Array.isArray(message.searchDiagnostics) ? message.searchDiagnostics : [];
  const raw = diagnostics.find((d) => d && typeof d === 'object' && !Array.isArray(d) && d.kind === EXPERIENCE_KIND);
  const parsed = experienceSchema.safeParse(raw);
  if (!parsed.success) return false;
  // Repair a transient missed experience write using the durable business history.
  if (!await answerCache.remember?.({ id: message.id, ...parsed.data })) return false;
  const owner = await db.businessHermesConsultation.findUnique({ where: { id: consultationId }, select: { createdByUserId: true } });
  const canPromote = caller.kind === 'user' &&
    (caller.role === 'ADMIN' || caller.role === 'MANAGER' || (owner !== null && owner.createdByUserId !== caller.userId));
  if (!await answerCache.feedback?.(message.id, verdict, canPromote)) return false;
  await db.businessHermesConsultationMessage.update({ where: { id: message.id }, data: {
    searchDiagnostics: (diagnostics.map((d) => d === raw ? { kind: EXPERIENCE_KIND, ...parsed.data, verdict } : d)) as Prisma.InputJsonValue
  } });
  return true;
}
