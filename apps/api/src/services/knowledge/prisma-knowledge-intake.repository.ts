import { Prisma, type PrismaClient, type KnowledgeIntake } from '@prisma/client';

import { KNOWLEDGE_TOPIC, knowledgeSourceSchema, organizedNoteSchema } from './knowledge-source.js';
import type { KnowledgeSource, OrganizedNote } from './knowledge-source.js';
import type { Intake, IntakeResult, KnowledgeAction, KnowledgeIntakeRepositoryPort } from './knowledge-intake.port.js';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const decode = (row: KnowledgeIntake): Intake => ({ ...row,
  files: row.files as unknown as Intake['files'],
  sources: row.sources ? knowledgeSourceSchema.array().parse(row.sources) : null,
  organized: row.organized ? organizedNoteSchema.array().parse(row.organized) : null,
  action: row.action as KnowledgeAction | null,
  result: row.result as unknown as IntakeResult | null,
});

export class PrismaKnowledgeIntakeRepository implements KnowledgeIntakeRepositoryPort {
  constructor(private readonly db: PrismaClient) {}

  async receive(input: Pick<Intake, 'id' | 'ownerKey' | 'conversationId' | 'inputHash' | 'text' | 'files'>): Promise<Intake> {
    const row = await this.db.knowledgeIntake.upsert({ where: { id: input.id }, update: {}, create: { ...input, files: asJson(input.files) } });
    if (row.ownerKey !== input.ownerKey || row.inputHash !== input.inputHash || row.conversationId !== input.conversationId) throw new Error('INTAKE_CONFLICT');
    return decode(row);
  }

  async accepted(id: string, owner: string) {
    await this.db.$transaction(async tx => {
      const row = await tx.knowledgeIntake.findFirst({ where: { id, ownerKey: owner } });
      if (!row || row.state !== 'receiving') return;
      await tx.knowledgeIntake.updateMany({ where: { ownerKey: owner, conversationId: row.conversationId, state: 'choice', sequence: { lte: row.sequence }, id: { not: id } }, data: { state: 'superseded', version: { increment: 1 } } });
      await tx.knowledgeIntake.update({ where: { id }, data: { state: 'pending' } });
    });
  }

  async get(id: string, owner: string) {
    const row = await this.db.knowledgeIntake.findFirst({ where: { id, ownerKey: owner } });
    return row ? decode(row) : null;
  }

  async route(id: string, owner: string, action: KnowledgeAction): Promise<KnowledgeAction> {
    return this.db.$transaction(async tx => {
      const row = await tx.knowledgeIntake.findFirstOrThrow({ where: { id, ownerKey: owner } });
      if (row.action) return row.action as KnowledgeAction;
      const newer = action === 'clarify' && await tx.knowledgeIntake.findFirst({ where: { ownerKey: owner, conversationId: row.conversationId, sequence: { gt: row.sequence } } });
      await tx.knowledgeIntake.updateMany({ where: { id, action: null, state: { in: ['pending', 'working'] } }, data: {
        action, state: action === 'clarify' ? (newer ? 'superseded' : 'choice') : action === 'delegate' ? 'delegated' : row.state,
        version: { increment: 1 }, result: asJson({ message: action === 'clarify' ? 'この内容は、どのように扱いますか？' : action === 'delegate' ? '通常の業務相談に引き継ぎます。' : '受け付けました。処理中です。' }),
      } });
      return (await tx.knowledgeIntake.findUniqueOrThrow({ where: { id } })).action as KnowledgeAction;
    });
  }

  async history(owner: string, conversationId: string) {
    return (await this.db.knowledgeIntake.findMany({ where: { ownerKey: owner, conversationId }, orderBy: { sequence: 'desc' }, take: 20 })).reverse().map(decode);
  }

  async choose(id: string, owner: string, version: number, action: KnowledgeAction) {
    return this.db.$transaction(async tx => {
      const row = await tx.knowledgeIntake.findFirst({ where: { id, ownerKey: owner, state: 'choice', version } });
      if (!row) return false;
      const latest = await tx.knowledgeIntake.findFirst({ where: { ownerKey: owner, conversationId: row.conversationId }, orderBy: { sequence: 'desc' } });
      if (latest?.id !== id) return false;
      const result = await tx.knowledgeIntake.updateMany({ where: { id, state: 'choice', version }, data: { action, state: 'pending', version: { increment: 1 }, attempts: 0, retryAt: new Date() } });
      return result.count === 1;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async retry(id: string, owner: string, version: number) {
    return (await this.db.knowledgeIntake.updateMany({ where: { id, ownerKey: owner, state: 'failed', version },
      data: { state: 'pending', retryAt: new Date(), attempts: 0, errorCode: null, version: { increment: 1 } },
    })).count === 1;
  }

  async claim(token: string) {
    await this.db.knowledgeTopic.upsert({ where: { id: KNOWLEDGE_TOPIC.id }, update: {}, create: { id: KNOWLEDGE_TOPIC.id } });
    return this.db.$transaction(async tx => {
      const now = new Date();
      const lock = await tx.knowledgeTopic.updateMany({ where: { id: KNOWLEDGE_TOPIC.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 60_000) } });
      if (!lock.count) return null;
      const row = await tx.knowledgeIntake.findFirst({ where: { retryAt: { lte: now }, OR: [
        { state: 'working' }, { state: 'pending', action: { not: null } },
        { state: 'pending', action: null, updatedAt: { lt: new Date(Date.now() - 60_000) } },
      ] }, orderBy: { sequence: 'asc' } });
      if (!row) {
        await tx.knowledgeTopic.update({ where: { id: KNOWLEDGE_TOPIC.id }, data: { leaseToken: null, leaseUntil: null } });
        return null;
      }
      return decode(await tx.knowledgeIntake.update({ where: { id: row.id }, data: { state: 'working', attempts: { increment: 1 } } }));
    });
  }

  async renew(token: string) {
    return (await this.db.knowledgeTopic.updateMany({ where: { id: KNOWLEDGE_TOPIC.id, leaseToken: token, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 60_000) } })).count === 1;
  }
  async release(token: string) {
    await this.db.knowledgeTopic.updateMany({ where: { id: KNOWLEDGE_TOPIC.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
  }

  private async fenced(token: string, operation: (tx: Prisma.TransactionClient) => Promise<void>) {
    await this.db.$transaction(async tx => {
      const lock = await tx.knowledgeTopic.updateMany({ where: { id: KNOWLEDGE_TOPIC.id, leaseToken: token, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 60_000) } });
      if (!lock.count) throw new Error('KNOWLEDGE_LEASE_LOST');
      await operation(tx);
    });
  }

  async saveProgress(id: string, token: string, sources: KnowledgeSource[], organized: OrganizedNote[]) {
    await this.fenced(token, async tx => { await tx.knowledgeIntake.update({ where: { id }, data: { sources: asJson(sources), organized: asJson(organized) } }); });
  }
  async finish(id: string, token: string, state: string, action: KnowledgeAction, result: IntakeResult, revision?: string) {
    await this.fenced(token, async tx => {
      if (state === 'choice') {
        const row = await tx.knowledgeIntake.findUniqueOrThrow({ where: { id } });
        const newer = await tx.knowledgeIntake.findFirst({ where: { ownerKey: row.ownerKey, conversationId: row.conversationId, sequence: { gt: row.sequence } } });
        if (newer) state = 'superseded';
      }
      await tx.knowledgeIntake.update({ where: { id }, data: { state, action, result: asJson(result), errorCode: null, version: { increment: 1 } } });
      if (revision) await tx.knowledgeTopic.update({ where: { id: KNOWLEDGE_TOPIC.id }, data: { revision } });
    });
  }
  async fail(id: string, token: string, errorCode: string, deferred: boolean) {
    await this.fenced(token, async tx => {
      const row = await tx.knowledgeIntake.findUniqueOrThrow({ where: { id } });
      await tx.knowledgeIntake.update({ where: { id }, data: {
        state: !deferred && row.attempts >= 4 ? 'failed' : 'pending', errorCode,
        ...(deferred ? { attempts: { decrement: 1 } } : {}), retryAt: new Date(Date.now() + (deferred ? 60_000 : Math.min(300_000, 15_000 * 2 ** row.attempts))),
      } });
    });
  }
  async readySources() {
    const rows = await this.db.knowledgeIntake.findMany({ where: { state: 'ready' }, orderBy: { sequence: 'asc' } });
    return rows.flatMap(row => {
      const decoded = decode(row);
      return (decoded.sources ?? []).map((source, index) => ({ source, organized: decoded.organized![index]! }));
    });
  }
  async publication() { return (await this.db.knowledgeTopic.findUnique({ where: { id: KNOWLEDGE_TOPIC.id } }))?.revision ?? null; }
}
