import type { Prisma, PrismaClient } from '@prisma/client';
import type { KnowledgePositionRankEntry, KnowledgePositionRanksResponse } from '@raspi-system/shared-types';

import { canApprove, positionRank, type KnowledgeReviewEmployee } from './knowledge-position-rank.js';

type EmployeeDb = Pick<Prisma.TransactionClient, 'employee' | 'measuringInstrumentTag' | 'knowledgePositionRank'>;

export async function resolveKnowledgeEmployee(db: EmployeeDb, rawUid: string, approvalRequired = false): Promise<KnowledgeReviewEmployee> {
  const uid = rawUid.trim();
  if (!uid) throw new Error('KNOWLEDGE_UNKNOWN_EMPLOYEE');
  const [employee, instrument] = await Promise.all([
    db.employee.findUnique({ where: { nfcTagUid: uid }, select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true, positionName: true, status: true } }),
    db.measuringInstrumentTag.findUnique({ where: { rfidTagUid: uid }, select: { id: true } }),
  ]);
  if (instrument && employee) throw new Error('KNOWLEDGE_DUPLICATE_TAG');
  if (!employee?.nfcTagUid) throw new Error('KNOWLEDGE_UNKNOWN_EMPLOYEE');
  if (employee.status !== 'ACTIVE') throw new Error('KNOWLEDGE_INACTIVE_EMPLOYEE');
  const mapping = employee.positionName ? await db.knowledgePositionRank.findUnique({ where: { positionName: employee.positionName } }) : null;
  const rank = positionRank(mapping?.rank);
  if (approvalRequired && !canApprove(rank)) throw new Error('KNOWLEDGE_APPROVAL_FORBIDDEN');
  return { id: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName,
    nfcTagUid: employee.nfcTagUid, positionName: employee.positionName, rank };
}

export class PrismaKnowledgeReviewerRepository {
  constructor(private readonly db: PrismaClient) {}
  resolve(tagUid: string, approvalRequired = false) { return resolveKnowledgeEmployee(this.db, tagUid, approvalRequired); }
  async listRanks(): Promise<KnowledgePositionRanksResponse> {
    const [ranks, positions] = await Promise.all([
      this.db.knowledgePositionRank.findMany({ orderBy: { positionName: 'asc' } }),
      this.db.employee.groupBy({ by: ['positionName'], where: { positionName: { not: null } }, _count: { _all: true }, orderBy: { positionName: 'asc' } }),
    ]);
    const mapped = new Set(ranks.map(row => row.positionName));
    return { ranks: ranks.map(row => ({ positionName: row.positionName, rank: positionRank(row.rank) })),
      unmappedPositions: positions.flatMap(row => row.positionName && !mapped.has(row.positionName)
        ? [{ positionName: row.positionName, employeeCount: row._count._all }] : []) };
  }
  async replaceRanks(ranks: KnowledgePositionRankEntry[]): Promise<void> {
    await this.db.$transaction(async tx => {
      // Serialize whole-table replacement, including replacement with an empty mapping.
      await tx.$executeRaw`LOCK TABLE "KnowledgePositionRank" IN EXCLUSIVE MODE`;
      await tx.knowledgePositionRank.deleteMany();
      if (ranks.length) await tx.knowledgePositionRank.createMany({ data: ranks });
    });
  }
}
