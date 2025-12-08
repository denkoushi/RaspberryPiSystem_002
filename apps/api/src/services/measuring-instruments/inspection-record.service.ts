import type { InspectionRecord, InspectionResult, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface InspectionRecordCreateInput {
  measuringInstrumentId: string;
  loanId?: string | null;
  employeeId: string;
  inspectionItemId: string;
  result: InspectionResult;
  inspectedAt: Date;
}

export interface InspectionRecordQuery {
  measuringInstrumentId: string;
  startDate?: Date;
  endDate?: Date;
  employeeId?: string;
  result?: InspectionResult;
}

export class InspectionRecordService {
  async findByInstrument(query: InspectionRecordQuery): Promise<InspectionRecord[]> {
    const where: Prisma.InspectionRecordWhereInput = {
      measuringInstrumentId: query.measuringInstrumentId,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.startDate || query.endDate
        ? {
            inspectedAt: {
              gte: query.startDate,
              lte: query.endDate
            }
          }
        : {})
    };

    return await prisma.inspectionRecord.findMany({
      where,
      orderBy: { inspectedAt: 'desc' }
    });
  }

  async create(data: InspectionRecordCreateInput): Promise<InspectionRecord> {
    try {
      return await prisma.inspectionRecord.create({ data });
    } catch (error) {
      throw new ApiError(400, '点検記録の登録に失敗しました');
    }
  }
}
