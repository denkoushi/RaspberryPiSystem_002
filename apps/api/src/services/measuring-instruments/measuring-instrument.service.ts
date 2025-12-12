import { Prisma } from '@prisma/client';
import type { MeasuringInstrument, MeasuringInstrumentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface MeasuringInstrumentCreateInput {
  name: string;
  managementNumber: string;
  storageLocation?: string | null;
  measurementRange?: string | null;
  calibrationExpiryDate?: Date | null;
  status?: MeasuringInstrumentStatus;
  rfidTagUid?: string | null;
}

export interface MeasuringInstrumentUpdateInput {
  name?: string;
  managementNumber?: string;
  storageLocation?: string | null;
  measurementRange?: string | null;
  calibrationExpiryDate?: Date | null;
  status?: MeasuringInstrumentStatus;
  rfidTagUid?: string | null;
}

export interface MeasuringInstrumentQuery {
  search?: string;
  status?: MeasuringInstrumentStatus;
}

export class MeasuringInstrumentService {
  async findAll(query: MeasuringInstrumentQuery): Promise<MeasuringInstrument[]> {
    const where: Prisma.MeasuringInstrumentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { managementNumber: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    return await prisma.measuringInstrument.findMany({
      where,
      orderBy: { name: 'asc' }
    });
  }

  async findById(id: string): Promise<MeasuringInstrument> {
    const instrument = await prisma.measuringInstrument.findUnique({ where: { id } });
    if (!instrument) {
      throw new ApiError(404, '計測機器が見つかりません');
    }
    return instrument;
  }

  async findByTagUid(tagUid: string): Promise<MeasuringInstrument | null> {
    const tag = await prisma.measuringInstrumentTag.findFirst({
      where: { rfidTagUid: tagUid },
      include: { measuringInstrument: true }
    });
    return tag?.measuringInstrument ?? null;
  }

  async create(data: MeasuringInstrumentCreateInput): Promise<MeasuringInstrument> {
    try {
      return await prisma.$transaction(async (tx) => {
        const instrument = await tx.measuringInstrument.create({
          data: {
            name: data.name,
            managementNumber: data.managementNumber,
            storageLocation: data.storageLocation ?? undefined,
            measurementRange: data.measurementRange ?? undefined,
            calibrationExpiryDate: data.calibrationExpiryDate ?? undefined,
            status: data.status ?? 'AVAILABLE'
          }
        });

        const tagUid = data.rfidTagUid?.trim();
        if (tagUid) {
          const existing = await tx.measuringInstrumentTag.findUnique({ where: { rfidTagUid: tagUid } });
          if (existing) {
            throw new ApiError(409, 'このタグUIDは既に他の計測機器に紐づいています');
          }
          await tx.measuringInstrumentTag.create({
            data: { measuringInstrumentId: instrument.id, rfidTagUid: tagUid }
          });
        }

        return instrument;
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'RFIDタグUIDが重複しています');
      }
      throw error;
    }
  }

  async update(id: string, data: MeasuringInstrumentUpdateInput): Promise<MeasuringInstrument> {
    const { rfidTagUid, ...instrumentData } = data;
    const tagUid = rfidTagUid?.trim();

    try {
      return await prisma.$transaction(async (tx) => {
        const instrument = await tx.measuringInstrument.update({
          where: { id },
          data: instrumentData
        });

        if (rfidTagUid !== undefined) {
          if (tagUid) {
            const existing = await tx.measuringInstrumentTag.findUnique({ where: { rfidTagUid: tagUid } });
            if (existing && existing.measuringInstrumentId !== id) {
              throw new ApiError(409, 'このタグUIDは既に他の計測機器に紐づいています');
            }
            await tx.measuringInstrumentTag.upsert({
              where: { rfidTagUid: tagUid },
              update: { measuringInstrumentId: id },
              create: { measuringInstrumentId: id, rfidTagUid: tagUid }
            });
          } else {
            // 空文字指定ならタグを削除
            await tx.measuringInstrumentTag.deleteMany({ where: { measuringInstrumentId: id } });
          }
        }

        return instrument;
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'RFIDタグUIDが重複しています');
      }
      throw new ApiError(404, '計測機器が見つかりません');
    }
  }

  async delete(id: string): Promise<MeasuringInstrument> {
    try {
      return await prisma.measuringInstrument.delete({ where: { id } });
    } catch (error) {
      throw new ApiError(404, '計測機器が見つかりません');
    }
  }
}
