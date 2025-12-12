import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { RiggingStatus } from '@prisma/client';

export interface RiggingGearInput {
  name: string;
  managementNumber: string;
  storageLocation?: string | null;
  department?: string | null;
  maxLoadTon?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  startedAt?: Date | null;
  status?: RiggingStatus;
  notes?: string | null;
  rfidTagUid?: string;
}

export interface RiggingGearQuery {
  search?: string;
  status?: RiggingStatus;
}

export class RiggingGearService {
  async findAll(query: RiggingGearQuery) {
    return prisma.riggingGear.findMany({
      where: {
        AND: [
          query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { managementNumber: { contains: query.search, mode: 'insensitive' } }
                ]
              }
            : undefined,
          query.status ? { status: query.status } : undefined
        ]
      },
      orderBy: { managementNumber: 'asc' }
    });
  }

  async findById(id: string) {
    return prisma.riggingGear.findUnique({ where: { id } });
  }

  async findByTagUid(tagUid: string) {
    return prisma.riggingGear.findFirst({ where: { tags: { some: { rfidTagUid: tagUid } } } });
  }

  async create(input: RiggingGearInput) {
    return prisma.$transaction(async (tx) => {
      const gear = await tx.riggingGear.create({
        data: {
          name: input.name,
          managementNumber: input.managementNumber,
          storageLocation: input.storageLocation,
          department: input.department,
          maxLoadTon: input.maxLoadTon ?? undefined,
          lengthMm: input.lengthMm ?? undefined,
          widthMm: input.widthMm ?? undefined,
          thicknessMm: input.thicknessMm ?? undefined,
          startedAt: input.startedAt ?? undefined,
          status: input.status,
          notes: input.notes ?? undefined
        }
      });

      if (input.rfidTagUid) {
        await tx.riggingGearTag.create({
          data: { riggingGearId: gear.id, rfidTagUid: input.rfidTagUid }
        });
      }

      return gear;
    });
  }

  async update(id: string, input: Partial<RiggingGearInput>) {
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, '更新項目がありません');
    }

    return prisma.$transaction(async (tx) => {
      const gear = await tx.riggingGear.update({
        where: { id },
        data: {
          name: input.name,
          managementNumber: input.managementNumber,
          storageLocation: input.storageLocation,
          department: input.department,
          maxLoadTon: input.maxLoadTon,
          lengthMm: input.lengthMm,
          widthMm: input.widthMm,
          thicknessMm: input.thicknessMm,
          startedAt: input.startedAt,
          status: input.status,
          notes: input.notes
        }
      });

      if (input.rfidTagUid !== undefined) {
        // 既存タグを全削除して再作成（単一タグ前提）
        await tx.riggingGearTag.deleteMany({ where: { riggingGearId: id } });
        if (input.rfidTagUid) {
          await tx.riggingGearTag.create({
            data: { riggingGearId: id, rfidTagUid: input.rfidTagUid }
          });
        }
      }

      return gear;
    });
  }

  async delete(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.riggingInspectionRecord.deleteMany({ where: { riggingGearId: id } });
      await tx.riggingGearTag.deleteMany({ where: { riggingGearId: id } });
      return tx.riggingGear.delete({ where: { id } });
    });
  }
}
