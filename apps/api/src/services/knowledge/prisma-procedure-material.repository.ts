import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient, KnowledgeProcedureMaterial } from '@prisma/client';

import { knowledgeSourceSchema, organizedNoteSchema } from './knowledge-source.js';
import { PROCEDURE_MATERIAL_STATES, type ProcedureMaterial, type ProcedureMaterialRepositoryPort } from './procedure-material.port.js';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function decode(row: KnowledgeProcedureMaterial): ProcedureMaterial {
  const state = PROCEDURE_MATERIAL_STATES.find(value => value === row.state);
  if (!state) throw new Error(`Unknown procedure material state: ${row.state}`);
  return {
    id: row.id, intakeId: row.intakeId, state, procedureId: row.procedureId, attempts: row.attempts, createdAt: row.createdAt,
    source: knowledgeSourceSchema.parse(row.source), organized: organizedNoteSchema.parse(row.organized),
  };
}

export class PrismaProcedureMaterialRepository implements ProcedureMaterialRepositoryPort {
  constructor(private readonly db: PrismaClient) {}

  async enqueue(intakeId: string, items: Parameters<ProcedureMaterialRepositoryPort['enqueue']>[1]) {
    await this.db.knowledgeProcedureMaterial.createMany({
      data: items.map(({ source, organized }) => ({ id: randomUUID(), intakeId, sourceId: source.id, source: asJson(source), organized: asJson(organized) })),
      skipDuplicates: true,
    });
  }

  async claim(token: string) {
    return this.db.$transaction(async tx => {
      const now = new Date();
      const row = await tx.knowledgeProcedureMaterial.findFirst({
        where: { state: 'pending', retryAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        orderBy: { createdAt: 'asc' },
      });
      if (!row) return null;
      // Compare-and-set on the observed lease so two workers cannot both win the row.
      const won = await tx.knowledgeProcedureMaterial.updateMany({
        where: { id: row.id, state: 'pending', leaseUntil: row.leaseUntil },
        data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
      });
      if (!won.count) return null;
      return decode(await tx.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: row.id } }));
    });
  }

  async renew(id: string, token: string) {
    return (await this.db.knowledgeProcedureMaterial.updateMany({
      where: { id, leaseToken: token, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    })).count === 1;
  }

  async materialsOf(procedureId: string, limit: number) {
    const rows = await this.db.knowledgeProcedureMaterial.findMany({ where: { procedureId, state: 'assigned' }, orderBy: { createdAt: 'asc' }, take: limit });
    return rows.map(decode);
  }

  async finish(id: string, token: string, outcome: { procedureId: string } | { unassigned: true }) {
    const done = await this.db.knowledgeProcedureMaterial.updateMany({
      where: { id, leaseToken: token, leaseUntil: { gt: new Date() } },
      data: 'procedureId' in outcome
        ? { state: 'assigned', procedureId: outcome.procedureId, leaseToken: null, leaseUntil: null, errorCode: null }
        : { state: 'unassigned', procedureId: null, leaseToken: null, leaseUntil: null, errorCode: null },
    });
    if (!done.count) throw new Error('PROCEDURE_MATERIAL_LEASE_LOST');
  }

  async fail(id: string, token: string, errorCode: string, deferred: boolean) {
    const row = await this.db.knowledgeProcedureMaterial.findUnique({ where: { id } });
    if (!row || row.leaseToken !== token) return;
    const exhausted = !deferred && row.attempts >= MAX_ATTEMPTS;
    await this.db.knowledgeProcedureMaterial.updateMany({ where: { id, leaseToken: token }, data: {
      state: exhausted ? 'failed' : 'pending', errorCode, leaseToken: null, leaseUntil: null,
      // Admission refusal is not the material's fault and must not exhaust its attempts.
      ...(deferred ? { attempts: { decrement: 1 } } : {}),
      retryAt: new Date(Date.now() + (deferred ? 60_000 : Math.min(300_000, 15_000 * 2 ** row.attempts))),
    } });
  }
}
