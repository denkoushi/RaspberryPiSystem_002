import type { Prisma } from '@prisma/client';

export async function markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(
  db: Prisma.TransactionClient,
  sessionId: string,
  now = new Date()
): Promise<void> {
  const measurableSessionWhere: Prisma.SelfInspectionSessionWhereInput = {
    id: sessionId,
    recordApprovalWorkflowStartedAt: { not: null },
    entries: {
      some: {
        values: { some: {} }
      }
    }
  };

  const activated = await db.selfInspectionSession.updateMany({
    where: {
      ...measurableSessionWhere,
      recordApprovalRequiredAt: null
    },
    data: {
      recordApprovalRequiredAt: now,
      updatedAt: now
    }
  });

  if (activated.count > 0) return;

  await db.selfInspectionSession.updateMany({
    where: {
      ...measurableSessionWhere,
      recordApprovalRequiredAt: { not: null }
    },
    data: {
      updatedAt: now
    }
  });
}
