import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient, KnowledgeTriage } from '@prisma/client';

import { composeTitle } from './procedure-content.js';
import { TRIAGE_STATES, type Triage, type TriageDestination, type TriageRepositoryPort, type TriageSuggestions } from './triage.port.js';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function decode(row: KnowledgeTriage): Triage {
  const state = TRIAGE_STATES.find(value => value === row.state);
  if (!state) throw new Error(`Unknown triage state: ${row.state}`);
  return {
    intakeId: row.intakeId, posterEmployeeId: row.posterEmployeeId, state, decidedProcedureId: row.decidedProcedureId,
    suggestions: row.suggestions as unknown as TriageSuggestions | null, createdAt: row.createdAt,
  };
}

export class PrismaTriageRepository implements TriageRepositoryPort {
  constructor(private readonly db: PrismaClient) {}

  async open(intakeId: string, posterEmployeeId: string | null) {
    await this.db.knowledgeTriage.upsert({ where: { intakeId }, update: {}, create: { intakeId, posterEmployeeId } });
  }

  async claimSuggesting(token: string) {
    return this.db.$transaction(async tx => {
      const now = new Date();
      const row = await tx.knowledgeTriage.findFirst({
        where: { state: 'suggesting', retryAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        orderBy: { createdAt: 'asc' },
      });
      if (!row) return null;
      const won = await tx.knowledgeTriage.updateMany({
        where: { intakeId: row.intakeId, state: 'suggesting', leaseUntil: row.leaseUntil },
        data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
      });
      return won.count ? decode(await tx.knowledgeTriage.findUniqueOrThrow({ where: { intakeId: row.intakeId } })) : null;
    });
  }

  async saveSuggestions(intakeId: string, token: string, suggestions: TriageSuggestions) {
    const done = await this.db.knowledgeTriage.updateMany({
      where: { intakeId, state: 'suggesting', leaseToken: token, leaseUntil: { gt: new Date() } },
      data: { state: 'awaiting', suggestions: asJson(suggestions), leaseToken: null, leaseUntil: null, errorCode: null },
    });
    if (!done.count) throw new Error('KNOWLEDGE_TRIAGE_LEASE_LOST');
  }

  async failSuggesting(intakeId: string, token: string, errorCode: string, deferred: boolean) {
    const row = await this.db.knowledgeTriage.findUnique({ where: { intakeId } });
    if (!row || row.leaseToken !== token) return;
    // After repeated failures the poster still decides, just without suggestions.
    const exhausted = !deferred && row.attempts >= MAX_ATTEMPTS;
    await this.db.knowledgeTriage.updateMany({ where: { intakeId, leaseToken: token }, data: {
      state: exhausted ? 'awaiting' : 'suggesting', errorCode, leaseToken: null, leaseUntil: null,
      ...(exhausted ? { suggestions: asJson({ candidates: [], proposal: null, confidence: 0 } satisfies TriageSuggestions) } : {}),
      ...(deferred ? { attempts: { decrement: 1 } } : {}),
      retryAt: new Date(Date.now() + (deferred ? 60_000 : Math.min(300_000, 15_000 * 2 ** row.attempts))),
    } });
  }

  async get(intakeIds: string[]) {
    if (!intakeIds.length) return [];
    return (await this.db.knowledgeTriage.findMany({ where: { intakeId: { in: intakeIds } } })).map(decode);
  }

  async awaitingFor(employeeId: string) {
    const rows = await this.db.knowledgeTriage.findMany({ where: { posterEmployeeId: employeeId, state: { in: ['suggesting', 'awaiting'] } }, orderBy: { createdAt: 'asc' }, take: 50 });
    return rows.map(decode);
  }

  async decide(intakeId: string, employeeId: string, destination: TriageDestination) {
    return this.db.$transaction(async tx => {
      const triage = await tx.knowledgeTriage.findUnique({ where: { intakeId } });
      if (!triage || triage.posterEmployeeId !== employeeId) throw new Error('TRIAGE_NOT_YOURS');
      if (triage.state === 'decided') throw new Error('TRIAGE_ALREADY_DECIDED');
      let procedureId: string;
      if ('procedureId' in destination) {
        const topic = await tx.knowledgeProcedure.findUnique({ where: { id: destination.procedureId } });
        if (!topic) throw new Error('UNKNOWN_PROCEDURE_TOPIC');
        procedureId = topic.id;
      } else {
        const { parts, identifiers, reviewTier } = destination.newTopic;
        const workType = await tx.knowledgeWorkType.findFirst({ where: { name: parts.workType, active: true } });
        if (!workType) throw new Error('UNKNOWN_WORK_TYPE');
        procedureId = randomUUID();
        await tx.knowledgeProcedure.create({ data: {
          id: procedureId, title: composeTitle(parts), category: parts.workType, target: parts.target, workType: parts.workType,
          detail: parts.detail ?? null, reviewTier, partNumber: identifiers.partNumber ?? null,
          drawingNumber: identifiers.drawingNumber ?? null, processName: identifiers.processName ?? null,
        } });
      }
      // Compare-and-set on the state so a concurrent second decision cannot also assign.
      const decided = await tx.knowledgeTriage.updateMany({
        where: { intakeId, state: { in: ['suggesting', 'awaiting'] } },
        data: { state: 'decided', decidedProcedureId: procedureId, decidedAt: new Date(), leaseToken: null, leaseUntil: null },
      });
      if (!decided.count) throw new Error('TRIAGE_ALREADY_DECIDED');
      await tx.knowledgeProcedureMaterial.updateMany({ where: { intakeId }, data: { state: 'assigned', procedureId } });
      await tx.knowledgeProcedure.update({ where: { id: procedureId }, data: { buildRequestedAt: new Date(), buildAttempts: 0, buildRetryAt: null, buildErrorCode: null } });
      return { procedureId };
    });
  }
}
