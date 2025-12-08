import type { InspectionItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface InspectionItemCreateInput {
  measuringInstrumentId: string;
  name: string;
  content: string;
  criteria: string;
  method: string;
  order: number;
}

export interface InspectionItemUpdateInput {
  name?: string;
  content?: string;
  criteria?: string;
  method?: string;
  order?: number;
}

export class InspectionItemService {
  async findByInstrument(measuringInstrumentId: string): Promise<InspectionItem[]> {
    return await prisma.inspectionItem.findMany({
      where: { measuringInstrumentId },
      orderBy: { order: 'asc' }
    });
  }

  async create(data: InspectionItemCreateInput): Promise<InspectionItem> {
    return await prisma.inspectionItem.create({
      data
    });
  }

  async update(id: string, data: InspectionItemUpdateInput): Promise<InspectionItem> {
    try {
      return await prisma.inspectionItem.update({
        where: { id },
        data
      });
    } catch (error) {
      throw new ApiError(404, '点検項目が見つかりません');
    }
  }

  async delete(id: string): Promise<InspectionItem> {
    try {
      return await prisma.inspectionItem.delete({ where: { id } });
    } catch (error) {
      throw new ApiError(404, '点検項目が見つかりません');
    }
  }
}
