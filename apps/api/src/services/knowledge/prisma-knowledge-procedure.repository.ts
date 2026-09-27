import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient, KnowledgeProcedure, KnowledgeProcedureRevision } from '@prisma/client';
import type { KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

import type { KnowledgeProcedureRepositoryPort, NewProcedureRevision } from './knowledge-procedure.port.js';
import { procedureContentSchema, procedureHeaderSchema, PROCEDURE_REVIEW_TIERS, PROCEDURE_REVISION_STATES } from './procedure-content.js';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const orUndefined = (value: string | null) => value ?? undefined;

function identifiers(row: KnowledgeProcedure) {
  return { partNumber: orUndefined(row.partNumber), drawingNumber: orUndefined(row.drawingNumber), processName: orUndefined(row.processName) };
}
function reviewTier(row: KnowledgeProcedure) {
  const tier = PROCEDURE_REVIEW_TIERS.find(value => value === row.reviewTier);
  if (!tier) throw new Error(`Unknown procedure review tier: ${row.reviewTier}`);
  return tier;
}
function toDocument(procedure: KnowledgeProcedure, revision: KnowledgeProcedureRevision): KnowledgeProcedureDocument {
  const state = PROCEDURE_REVISION_STATES.find(value => value === revision.state);
  if (!state) throw new Error(`Unknown procedure revision state: ${revision.state}`);
  return {
    formatVersion: 1, procedureId: procedure.id, revisionId: revision.id, revisionNumber: revision.revisionNumber,
    title: procedure.title, category: procedure.category, identifiers: identifiers(procedure), reviewTier: reviewTier(procedure),
    state, createdAt: revision.createdAt.toISOString(), steps: procedureContentSchema.parse(revision.content).steps,
  };
}

export class PrismaKnowledgeProcedureRepository implements KnowledgeProcedureRepositoryPort {
  constructor(private readonly db: PrismaClient) {}

  async createDraft(input: NewProcedureRevision) {
    const header = procedureHeaderSchema.parse(input.header);
    const content = procedureContentSchema.parse(input.content);
    const fields = {
      title: header.title, category: header.category, reviewTier: header.reviewTier,
      partNumber: header.identifiers.partNumber ?? null, drawingNumber: header.identifiers.drawingNumber ?? null,
      processName: header.identifiers.processName ?? null,
    };
    return this.db.$transaction(async tx => {
      const procedureId = input.procedureId ?? randomUUID();
      if (input.procedureId) await tx.knowledgeProcedure.update({ where: { id: procedureId }, data: fields });
      else await tx.knowledgeProcedure.create({ data: { id: procedureId, ...fields } });
      const latest = await tx.knowledgeProcedureRevision.aggregate({ where: { procedureId }, _max: { revisionNumber: true } });
      const revisionNumber = (latest._max.revisionNumber ?? 0) + 1;
      // The (procedureId, revisionNumber) unique index rejects a concurrent writer instead of duplicating a number.
      const revision = await tx.knowledgeProcedureRevision.create({ data: {
        id: randomUUID(), procedureId, revisionNumber, state: 'draft', content: asJson(content), createdByKey: input.createdByKey,
      } });
      return { procedureId, revisionId: revision.id, revisionNumber };
    });
  }

  async publishAutomatic(revisionId: string) {
    await this.db.$transaction(async tx => {
      const revision = await tx.knowledgeProcedureRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { procedure: true } });
      if (reviewTier(revision.procedure) !== 'auto_publish') throw new Error('PROCEDURE_REQUIRES_APPROVAL');
      if (revision.state !== 'draft') throw new Error('PROCEDURE_REVISION_NOT_DRAFT');
      const previous = revision.procedure.publishedRevisionId;
      if (previous) await tx.knowledgeProcedureRevision.update({ where: { id: previous }, data: { state: 'superseded' } });
      await tx.knowledgeProcedureRevision.update({ where: { id: revisionId }, data: { state: 'published' } });
      await tx.knowledgeProcedure.update({ where: { id: revision.procedureId }, data: { publishedRevisionId: revisionId } });
    });
  }

  async listPublished(): Promise<KnowledgeProcedureSummary[]> {
    const rows = await this.db.knowledgeProcedure.findMany({
      where: { publishedRevisionId: { not: null } }, include: { publishedRevision: true }, orderBy: { title: 'asc' },
    });
    return rows.flatMap(row => row.publishedRevision ? [{
      procedureId: row.id, title: row.title, category: row.category, identifiers: identifiers(row), reviewTier: reviewTier(row),
      revisionNumber: row.publishedRevision.revisionNumber, publishedAt: row.publishedRevision.updatedAt.toISOString(),
    }] : []);
  }

  async getPublished(procedureId: string) {
    const row = await this.db.knowledgeProcedure.findUnique({ where: { id: procedureId }, include: { publishedRevision: true } });
    return row?.publishedRevision ? toDocument(row, row.publishedRevision) : null;
  }
}
