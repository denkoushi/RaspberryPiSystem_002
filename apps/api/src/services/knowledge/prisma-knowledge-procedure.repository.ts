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
const BUILD_LEASE_MS = 60_000;
const MAX_BUILD_ATTEMPTS = 5;

function topicRecord(row: KnowledgeProcedure) {
  return {
    procedureId: row.id,
    header: { title: row.title, category: row.category, identifiers: identifiers(row), reviewTier: reviewTier(row) },
    parts: row.target && row.workType ? { target: row.target, workType: row.workType, ...(row.detail ? { detail: row.detail } : {}) } : null,
  };
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

  async listTopics() {
    return (await this.db.knowledgeProcedure.findMany({ orderBy: { createdAt: 'asc' } })).map(topicRecord);
  }

  async searchTopics(query: string, limit: number) {
    const q = query.trim();
    const rows = await this.db.knowledgeProcedure.findMany({
      where: q ? { OR: [
        { title: { contains: q, mode: 'insensitive' } }, { partNumber: { contains: q, mode: 'insensitive' } },
        { drawingNumber: { contains: q, mode: 'insensitive' } },
      ] } : {},
      orderBy: { updatedAt: 'desc' }, take: limit,
    });
    return rows.map(topicRecord);
  }

  async claimBuild(token: string) {
    return this.db.$transaction(async tx => {
      const now = new Date();
      const row = await tx.knowledgeProcedure.findFirst({
        where: { buildRequestedAt: { not: null }, OR: [{ buildRetryAt: null }, { buildRetryAt: { lte: now } }],
          AND: [{ OR: [{ buildLeaseUntil: null }, { buildLeaseUntil: { lt: now } }] }] },
        orderBy: { buildRequestedAt: 'asc' },
      });
      if (!row?.buildRequestedAt) return null;
      const won = await tx.knowledgeProcedure.updateMany({
        where: { id: row.id, buildLeaseUntil: row.buildLeaseUntil },
        data: { buildLeaseToken: token, buildLeaseUntil: new Date(now.getTime() + BUILD_LEASE_MS), buildAttempts: { increment: 1 } },
      });
      return won.count ? { procedureId: row.id, header: topicRecord(row).header, requestedAt: row.buildRequestedAt } : null;
    });
  }

  async completeBuild(procedureId: string, token: string, requestedAt: Date) {
    await this.db.knowledgeProcedure.updateMany({ where: { id: procedureId, buildLeaseToken: token }, data: { buildLeaseToken: null, buildLeaseUntil: null } });
    // A decision that arrived during the build moved buildRequestedAt, so the topic is built again.
    await this.db.knowledgeProcedure.updateMany({ where: { id: procedureId, buildRequestedAt: requestedAt },
      data: { buildRequestedAt: null, buildAttempts: 0, buildRetryAt: null, buildErrorCode: null } });
  }

  async failBuild(procedureId: string, token: string, errorCode: string, deferred: boolean) {
    const row = await this.db.knowledgeProcedure.findUnique({ where: { id: procedureId } });
    if (!row || row.buildLeaseToken !== token) return;
    // Exhausted builds stop retrying but keep the request so the next decision or release retries.
    const exhausted = !deferred && row.buildAttempts >= MAX_BUILD_ATTEMPTS;
    await this.db.knowledgeProcedure.updateMany({ where: { id: procedureId, buildLeaseToken: token }, data: {
      buildErrorCode: errorCode, buildLeaseToken: null, buildLeaseUntil: null,
      ...(deferred ? { buildAttempts: { decrement: 1 } } : {}),
      buildRetryAt: new Date(Date.now() + (exhausted ? 24 * 3_600_000 : deferred ? 60_000 : Math.min(300_000, 15_000 * 2 ** row.buildAttempts))),
    } });
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
