import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient, KnowledgeProcedureMaterial } from '@prisma/client';

import { knowledgeSourceSchema, organizedNoteSchema } from './knowledge-source.js';
import { PROCEDURE_MATERIAL_STATES, type ProcedureMaterial, type ProcedureMaterialRepositoryPort } from './procedure-material.port.js';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function decode(row: KnowledgeProcedureMaterial): ProcedureMaterial {
  const state = PROCEDURE_MATERIAL_STATES.find(value => value === row.state);
  if (!state) throw new Error(`Unknown procedure material state: ${row.state}`);
  return {
    id: row.id, intakeId: row.intakeId, state, procedureId: row.procedureId, createdAt: row.createdAt,
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

  async materialsOfIntake(intakeId: string) {
    const rows = await this.db.knowledgeProcedureMaterial.findMany({ where: { intakeId }, orderBy: { createdAt: 'asc' } });
    return rows.map(decode);
  }

  async materialsOf(procedureId: string, limit: number) {
    const rows = await this.db.knowledgeProcedureMaterial.findMany({ where: { procedureId, state: 'assigned' }, orderBy: { createdAt: 'asc' }, take: limit });
    return rows.map(decode);
  }
}
