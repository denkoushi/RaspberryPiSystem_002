import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export type CsvImportSubjectPatternInput = {
  importType: 'employees' | 'items' | 'measuringInstruments' | 'riggingGears';
  pattern: string;
  priority?: number | null;
  enabled?: boolean | null;
};

export type CsvImportSubjectPatternUpdate = Partial<
  Omit<CsvImportSubjectPatternInput, 'importType'>
>;

export class CsvImportSubjectPatternService {
  async list(importType?: CsvImportSubjectPatternInput['importType']) {
    return prisma.csvImportSubjectPattern.findMany({
      where: importType ? { importType } : undefined,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(input: CsvImportSubjectPatternInput) {
    try {
      return await prisma.csvImportSubjectPattern.create({
        data: {
          importType: input.importType,
          pattern: input.pattern,
          priority: input.priority ?? 0,
          enabled: input.enabled ?? true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, '同じimportTypeとpatternの組み合わせが既に存在します');
      }
      throw error;
    }
  }

  async update(id: string, update: CsvImportSubjectPatternUpdate) {
    const existing = await prisma.csvImportSubjectPattern.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, '件名パターンが見つかりません');
    }

    try {
      return await prisma.csvImportSubjectPattern.update({
        where: { id },
        data: {
          pattern: update.pattern ?? undefined,
          priority: update.priority ?? undefined,
          enabled: update.enabled ?? undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, '同じimportTypeとpatternの組み合わせが既に存在します');
      }
      throw error;
    }
  }

  async delete(id: string) {
    const existing = await prisma.csvImportSubjectPattern.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, '件名パターンが見つかりません');
    }
    await prisma.csvImportSubjectPattern.delete({ where: { id } });
  }

  async reorder(importType: CsvImportSubjectPatternInput['importType'], orderedIds: string[]) {
    const existing = await prisma.csvImportSubjectPattern.findMany({
      where: { importType },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((item) => item.id));
    const providedIds = new Set(orderedIds);

    if (existingIds.size !== orderedIds.length || existingIds.size !== providedIds.size) {
      throw new ApiError(400, '並べ替え対象のID一覧が一致しません');
    }

    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        throw new ApiError(400, '並べ替え対象のID一覧が一致しません');
      }
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.csvImportSubjectPattern.update({
          where: { id },
          data: { priority: index },
        })
      )
    );

    return this.list(importType);
  }
}
