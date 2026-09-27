import type { PrismaClient } from '@prisma/client';

import type { TriageRepositoryPort } from './triage.port.js';

/** Owner-approved initial work types (2026-09-27). Seeded only into an empty list; people curate it afterwards. */
export const INITIAL_WORK_TYPES = [
  '段取り', '切削条件', '加工手順', '検査・測定', '組立', '治具・工具', '保全・点検', '安全', '申し込み・手続き', '教育・技能', 'その他',
] as const;

/**
 * Idempotent start-up data that expand-only migrations may not insert: the initial work types,
 * and triage rows (without a poster) for queued posts that predate triage.
 */
export async function ensureKnowledgeReferenceData(db: PrismaClient, triage: TriageRepositoryPort): Promise<void> {
  if (await db.knowledgeWorkType.count() === 0) {
    await db.knowledgeWorkType.createMany({
      data: INITIAL_WORK_TYPES.map((name, index) => ({ name, sortOrder: name === 'その他' ? 1000 : (index + 1) * 10 })),
      skipDuplicates: true,
    });
  }
  const waiting = await db.knowledgeProcedureMaterial.findMany({
    where: { state: { in: ['pending', 'failed'] }, intakeId: { not: 'legacy-ready' } }, select: { intakeId: true }, distinct: ['intakeId'],
  });
  for (const { intakeId } of waiting) await triage.open(intakeId, null);
}
