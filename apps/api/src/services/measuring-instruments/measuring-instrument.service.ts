import type { MeasuringInstrument, MeasuringInstrumentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface MeasuringInstrumentCreateInput {
  name: string;
  managementNumber: string;
  storageLocation?: string | null;
  measurementRange?: string | null;
  calibrationExpiryDate?: Date | null;
  status?: MeasuringInstrumentStatus;
}

export interface MeasuringInstrumentUpdateInput {
  name?: string;
  managementNumber?: string;
  storageLocation?: string | null;
  measurementRange?: string | null;
  calibrationExpiryDate?: Date | null;
  status?: MeasuringInstrumentStatus;
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

  async create(data: MeasuringInstrumentCreateInput): Promise<MeasuringInstrument> {
    return await prisma.measuringInstrument.create({
      data: {
        name: data.name,
        managementNumber: data.managementNumber,
        storageLocation: data.storageLocation ?? undefined,
        measurementRange: data.measurementRange ?? undefined,
        calibrationExpiryDate: data.calibrationExpiryDate ?? undefined,
        status: data.status ?? 'AVAILABLE'
      }
    });
  }

  async update(id: string, data: MeasuringInstrumentUpdateInput): Promise<MeasuringInstrument> {
    try {
      return await prisma.measuringInstrument.update({
        where: { id },
        data
      });
    } catch (error) {
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
