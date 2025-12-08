import type { MeasuringInstrumentTag } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface TagCreateInput {
  measuringInstrumentId: string;
  rfidTagUid: string;
}

export class MeasuringInstrumentTagService {
  async findByInstrument(measuringInstrumentId: string): Promise<MeasuringInstrumentTag[]> {
    return await prisma.measuringInstrumentTag.findMany({
      where: { measuringInstrumentId }
    });
  }

  async create(data: TagCreateInput): Promise<MeasuringInstrumentTag> {
    return await prisma.measuringInstrumentTag.create({ data });
  }

  async delete(id: string): Promise<MeasuringInstrumentTag> {
    try {
      return await prisma.measuringInstrumentTag.delete({ where: { id } });
    } catch (error) {
      throw new ApiError(404, 'RFIDタグ紐付けが見つかりません');
    }
  }
}
