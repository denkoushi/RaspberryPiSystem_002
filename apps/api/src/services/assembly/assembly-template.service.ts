import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export const assemblyTemplateDetailInclude = {
  procedureDocument: true,
  areas: {
    orderBy: { sortOrder: 'asc' },
    include: {
      bolts: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  }
} satisfies Prisma.AssemblyTemplateInclude;

export type AssemblyTemplateDetail = Prisma.AssemblyTemplateGetPayload<{
  include: typeof assemblyTemplateDetailInclude;
}>;

export type AssemblyTemplateSummary = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  procedureDocumentId: string;
  procedureDocumentName: string;
  areaCount: number;
  boltCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AssemblyTemplateBoltInput = {
  sortOrder: number;
  tighteningId: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  boltSpec: string;
  nominalTorque: number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
};

export type AssemblyTemplateAreaInput = {
  sortOrder: number;
  processNo: string;
  areaCode: string;
  areaName: string;
  unitCode: string;
  requireManualAdvance?: boolean;
  bolts: AssemblyTemplateBoltInput[];
};

export type AssemblyTemplateUpsertInput = {
  modelCode: string;
  procedurePattern: string;
  name: string;
  procedureDocumentId: string;
  areas: AssemblyTemplateAreaInput[];
};

function normalizeKey(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(400, `${fieldName}が必要です`);
  return trimmed;
}

function normalizeAreas(areas: AssemblyTemplateAreaInput[]): AssemblyTemplateAreaInput[] {
  if (areas.length === 0) {
    throw new ApiError(400, '工程エリアが1件以上必要です');
  }
  return [...areas]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((area, areaIndex) => {
      if (area.bolts.length === 0) {
        throw new ApiError(400, `工程${area.processNo || areaIndex + 1}に締付箇所が必要です`);
      }
      return {
        ...area,
        sortOrder: areaIndex,
        processNo: normalizeKey(area.processNo, '工程No.').slice(0, 80),
        areaCode: normalizeKey(area.areaCode, 'エリアコード').slice(0, 80),
        areaName: normalizeKey(area.areaName, 'エリア名').slice(0, 200),
        unitCode: normalizeKey(area.unitCode, 'ユニットコード').slice(0, 80),
        bolts: [...area.bolts]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((bolt, boltIndex) => {
            if (bolt.lowerLimit > bolt.upperLimit) {
              throw new ApiError(400, `${bolt.tighteningId || boltIndex + 1}: 下限が上限を超えています`);
            }
            return {
              ...bolt,
              sortOrder: boltIndex,
              tighteningId: normalizeKey(bolt.tighteningId, '締付ID').slice(0, 120),
              markerNo: Math.max(1, Math.trunc(bolt.markerNo)),
              xRatio: clampRatio(bolt.xRatio),
              yRatio: clampRatio(bolt.yRatio),
              boltSpec: normalizeKey(bolt.boltSpec, 'ボルト仕様').slice(0, 200),
              unit: normalizeKey(bolt.unit, '単位').slice(0, 40)
            };
          })
      };
    });
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export class AssemblyTemplateService {
  async list(params: {
    includeInactive?: boolean;
    modelCode?: string;
    procedurePattern?: string;
    q?: string;
    limit?: number;
  }): Promise<AssemblyTemplateDetail[]> {
    const modelCode = params.modelCode?.trim();
    const procedurePattern = params.procedurePattern?.trim();
    const q = params.q?.trim();
    return prisma.assemblyTemplate.findMany({
      where: {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(modelCode ? { modelCode: { equals: modelCode, mode: 'insensitive' } } : {}),
        ...(procedurePattern ? { procedurePattern: { equals: procedurePattern, mode: 'insensitive' } } : {}),
        ...(q
          ? {
              OR: [
                { modelCode: { contains: q, mode: 'insensitive' } },
                { procedurePattern: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: assemblyTemplateDetailInclude,
      orderBy: [{ updatedAt: 'desc' }, { modelCode: 'asc' }, { procedurePattern: 'asc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });
  }

  async listSummary(params: {
    includeInactive?: boolean;
    modelCode?: string;
    procedurePattern?: string;
    procedureDocumentId?: string;
    procedureDocumentName?: string;
    q?: string;
    limit?: number;
  }): Promise<AssemblyTemplateSummary[]> {
    const modelCode = params.modelCode?.trim();
    const procedurePattern = params.procedurePattern?.trim();
    const procedureDocumentName = params.procedureDocumentName?.trim();
    const q = params.q?.trim();
    const templates = await prisma.assemblyTemplate.findMany({
      where: {
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(modelCode ? { modelCode: { equals: modelCode, mode: 'insensitive' } } : {}),
        ...(procedurePattern ? { procedurePattern: { equals: procedurePattern, mode: 'insensitive' } } : {}),
        ...(params.procedureDocumentId ? { procedureDocumentId: params.procedureDocumentId } : {}),
        ...(procedureDocumentName
          ? {
              procedureDocument: {
                name: { contains: procedureDocumentName, mode: 'insensitive' }
              }
            }
          : {}),
        ...(q
          ? {
              OR: [
                { modelCode: { contains: q, mode: 'insensitive' } },
                { procedurePattern: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
                { procedureDocument: { name: { contains: q, mode: 'insensitive' } } }
              ]
            }
          : {})
      },
      select: {
        id: true,
        modelCode: true,
        procedurePattern: true,
        name: true,
        version: true,
        isActive: true,
        procedureDocumentId: true,
        createdAt: true,
        updatedAt: true,
        procedureDocument: {
          select: {
            name: true
          }
        },
        areas: {
          select: {
            id: true,
            _count: {
              select: { bolts: true }
            }
          }
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { modelCode: 'asc' }, { procedurePattern: 'asc' }, { version: 'desc' }],
      take: Math.min(Math.max(params.limit ?? 100, 1), 200)
    });

    return templates.map((template) => ({
      id: template.id,
      modelCode: template.modelCode,
      procedurePattern: template.procedurePattern,
      name: template.name,
      version: template.version,
      isActive: template.isActive,
      procedureDocumentId: template.procedureDocumentId,
      procedureDocumentName: template.procedureDocument.name,
      areaCount: template.areas.length,
      boltCount: template.areas.reduce((sum, area) => sum + area._count.bolts, 0),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }));
  }

  async getById(id: string, options: { includeInactive?: boolean } = {}): Promise<AssemblyTemplateDetail | null> {
    return prisma.assemblyTemplate.findFirst({
      where: {
        id,
        ...(options.includeInactive ? {} : { isActive: true })
      },
      include: assemblyTemplateDetailInclude
    });
  }

  async create(input: AssemblyTemplateUpsertInput): Promise<AssemblyTemplateDetail> {
    const modelCode = normalizeKey(input.modelCode, '形番/FHINCD').slice(0, 120);
    const procedurePattern = normalizeKey(input.procedurePattern, '手順パターン').slice(0, 120);
    const name = normalizeKey(input.name, 'テンプレート名').slice(0, 200);
    const areas = normalizeAreas(input.areas);

    return prisma.$transaction(async (tx) => {
      const doc = await tx.assemblyProcedureDocument.findFirst({
        where: { id: input.procedureDocumentId, isActive: true }
      });
      if (!doc) throw new ApiError(404, '有効な手順書が見つかりません');

      const versionAgg = await tx.assemblyTemplate.aggregate({
        where: { modelCode, procedurePattern },
        _max: { version: true }
      });
      const version = (versionAgg._max.version ?? 0) + 1;
      await tx.assemblyTemplate.updateMany({
        where: { modelCode, procedurePattern, isActive: true },
        data: { isActive: false }
      });
      return tx.assemblyTemplate.create({
        data: {
          modelCode,
          procedurePattern,
          name,
          version,
          procedureDocumentId: doc.id,
          areas: {
            create: areas.map((area) => ({
              sortOrder: area.sortOrder,
              processNo: area.processNo,
              areaCode: area.areaCode,
              areaName: area.areaName,
              unitCode: area.unitCode,
              requireManualAdvance: area.requireManualAdvance ?? true,
              bolts: {
                create: area.bolts.map((bolt) => ({
                  sortOrder: bolt.sortOrder,
                  tighteningId: bolt.tighteningId,
                  markerNo: bolt.markerNo,
                  xRatio: bolt.xRatio,
                  yRatio: bolt.yRatio,
                  boltSpec: bolt.boltSpec,
                  nominalTorque: bolt.nominalTorque,
                  lowerLimit: bolt.lowerLimit,
                  upperLimit: bolt.upperLimit,
                  unit: bolt.unit
                }))
              }
            }))
          }
        },
        include: assemblyTemplateDetailInclude
      });
    });
  }

  async revise(id: string, input: Partial<AssemblyTemplateUpsertInput>): Promise<AssemblyTemplateDetail> {
    const source = await this.getById(id, { includeInactive: true });
    if (!source) throw new ApiError(404, 'テンプレートが見つかりません');
    const areas =
      input.areas ??
      source.areas.map((area) => ({
        sortOrder: area.sortOrder,
        processNo: area.processNo,
        areaCode: area.areaCode,
        areaName: area.areaName,
        unitCode: area.unitCode,
        requireManualAdvance: area.requireManualAdvance,
        bolts: area.bolts.map((bolt) => ({
          sortOrder: bolt.sortOrder,
          tighteningId: bolt.tighteningId,
          markerNo: bolt.markerNo,
          xRatio: Number(bolt.xRatio),
          yRatio: Number(bolt.yRatio),
          boltSpec: bolt.boltSpec,
          nominalTorque: Number(bolt.nominalTorque),
          lowerLimit: Number(bolt.lowerLimit),
          upperLimit: Number(bolt.upperLimit),
          unit: bolt.unit
        }))
      }));
    return this.create({
      modelCode: input.modelCode ?? source.modelCode,
      procedurePattern: input.procedurePattern ?? source.procedurePattern,
      name: input.name ?? source.name,
      procedureDocumentId: input.procedureDocumentId ?? source.procedureDocumentId,
      areas
    });
  }

  async retire(id: string) {
    try {
      await prisma.assemblyTemplate.update({
        where: { id },
        data: { isActive: false }
      });
      return 'retired' as const;
    } catch {
      return 'not_found' as const;
    }
  }
}
