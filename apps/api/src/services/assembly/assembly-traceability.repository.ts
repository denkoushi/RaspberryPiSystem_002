import { Prisma, type AssemblyWorkSessionStatus } from '@prisma/client';

import type { AssemblyTransactionWork } from './assembly-transaction.js';

export type AssemblyTraceabilityTransaction = Parameters<AssemblyTransactionWork<unknown>>[0];

export const workUnitWithSessionSelect = {
  id: true,
  workId: true,
  createdAt: true,
  workSession: {
    select: {
      id: true,
      status: true,
      productNo: true,
      targetUnit: true,
      template: { select: { name: true, version: true } },
      completedAt: true
    }
  }
} satisfies Prisma.AssemblyWorkUnitSelect;

/** 永続化に閉じたクエリ。業務判定は AssemblyTraceabilityService が担当する。 */
export class AssemblyTraceabilityRepository {
  async lockWorkUnits(tx: AssemblyTraceabilityTransaction, ids: string[]): Promise<void> {
    const distinctIds = [...new Set(ids)].sort();
    if (distinctIds.length === 0) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AssemblySerialRegistry" WHERE "id" IN (${Prisma.join(distinctIds)}) ORDER BY "id" FOR UPDATE`
    );
  }

  async lockActiveCompositionForWorkUnit(tx: AssemblyTraceabilityTransaction, workUnitId: string): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "AssemblyWorkUnitComposition" WHERE ("parentWorkUnitId" = ${workUnitId} OR "childWorkUnitId" = ${workUnitId}) AND "unlinkedAt" IS NULL FOR UPDATE`
    );
  }

  async hasActiveDescendant(tx: AssemblyTraceabilityTransaction, ancestorId: string, candidateId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      WITH RECURSIVE descendants AS (
        SELECT "childWorkUnitId" AS "id"
        FROM "AssemblyWorkUnitComposition"
        WHERE "parentWorkUnitId" = ${ancestorId} AND "unlinkedAt" IS NULL
        UNION
        SELECT composition."childWorkUnitId" AS "id"
        FROM "AssemblyWorkUnitComposition" AS composition
        INNER JOIN descendants ON composition."parentWorkUnitId" = descendants."id"
        WHERE composition."unlinkedAt" IS NULL
      )
      SELECT EXISTS(SELECT 1 FROM descendants WHERE "id" = ${candidateId}) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  async findTopLevelCompleted(tx: AssemblyTraceabilityTransaction, params: { query?: string; limit: number }) {
    return tx.assemblyWorkUnit.findMany({
      where: {
        workSession: { status: 'COMPLETED' as AssemblyWorkSessionStatus },
        childCompositionLinks: { none: { unlinkedAt: null } },
        ...(params.query
          ? {
              OR: [
                { workId: { contains: params.query, mode: 'insensitive' } },
                { workSession: { productNo: { contains: params.query, mode: 'insensitive' } } }
              ]
            }
          : {})
      },
      select: {
        ...workUnitWithSessionSelect,
        formalIdentifierAssignments: {
          where: { supersededAt: null },
          select: { id: true, formalId: true, assignedAt: true }
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: params.limit
    });
  }
}
