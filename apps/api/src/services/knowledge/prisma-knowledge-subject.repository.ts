import type { PrismaClient } from '@prisma/client';
import type { KnowledgeSubject } from '@raspi-system/shared-types';

export class PrismaKnowledgeSubjectRepository {
  constructor(private readonly db: PrismaClient) {}

  async search(query: string): Promise<KnowledgeSubject[]> {
    const q = query.trim();
    const groups = await this.db.knowledgeProcedure.groupBy({
      by: ['target'], where: { target: { not: null, ...(q ? { contains: q, mode: 'insensitive' as const } : {}) } },
      _count: { _all: true }, _max: { createdAt: true }, orderBy: { _max: { createdAt: 'desc' } }, take: 20,
    });
    const subjects = groups.map(row => ({ target: row.target!, topicCount: row._count._all }));
    if (q) {
      const machines = await this.db.machine.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { shortName: { contains: q, mode: 'insensitive' } }] },
        orderBy: { createdAt: 'desc' }, take: 20, select: { name: true } });
      const missing = [...new Set(machines.map(row => row.name))].filter(name => !subjects.some(subject => subject.target === name));
      const counts = missing.length ? await this.db.knowledgeProcedure.groupBy({ by: ['target'], where: { target: { in: missing } }, _count: { _all: true } }) : [];
      subjects.push(...missing.map(target => ({ target, topicCount: counts.find(row => row.target === target)?._count._all ?? 0 })));
    }
    return subjects.slice(0, 20);
  }

  async recent(employeeId: string): Promise<KnowledgeSubject[]> {
    const rows = await this.db.$queryRaw<{ target: string; topicCount: bigint }[]>`
      SELECT p."target", (SELECT count(*) FROM "KnowledgeProcedure" t WHERE t."target" = p."target") AS "topicCount"
      FROM "KnowledgeTriage" k JOIN "KnowledgeProcedure" p ON p."id" = k."decidedProcedureId"
      WHERE k."posterEmployeeId" = ${employeeId} AND k."state" = 'decided' AND p."target" IS NOT NULL
      GROUP BY p."target" ORDER BY max(k."decidedAt") DESC NULLS LAST LIMIT 6
    `;
    return rows.map(row => ({ target: row.target, topicCount: Number(row.topicCount) }));
  }
}
