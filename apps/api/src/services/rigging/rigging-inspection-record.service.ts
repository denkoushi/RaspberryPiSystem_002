import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { InspectionResult } from '@prisma/client';

export interface RiggingInspectionRecordInput {
  riggingGearId: string;
  loanId?: string | null;
  employeeId: string;
  result: InspectionResult;
  inspectedAt: Date;
  notes?: string | null;
}

export interface RiggingInspectionQuery {
  startDate?: Date;
  endDate?: Date;
  employeeId?: string;
  result?: InspectionResult;
}

export class RiggingInspectionRecordService {
  async findByRiggingGear(riggingGearId: string, query: RiggingInspectionQuery) {
    return prisma.riggingInspectionRecord.findMany({
      where: {
        riggingGearId,
        employeeId: query.employeeId,
        result: query.result,
        inspectedAt: {
          gte: query.startDate,
          lte: query.endDate
        }
      },
      orderBy: { inspectedAt: 'desc' }
    });
  }

  async create(input: RiggingInspectionRecordInput) {
    const gear = await prisma.riggingGear.findUnique({ where: { id: input.riggingGearId } });
    if (!gear) {
      throw new ApiError(404, '吊具が見つかりません');
    }
    const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) {
      throw new ApiError(404, '従業員が見つかりません');
    }

    return prisma.riggingInspectionRecord.create({
      data: {
        riggingGearId: input.riggingGearId,
        loanId: input.loanId ?? undefined,
        employeeId: input.employeeId,
        result: input.result,
        inspectedAt: input.inspectedAt,
        notes: input.notes ?? undefined
      }
    });
  }
}
