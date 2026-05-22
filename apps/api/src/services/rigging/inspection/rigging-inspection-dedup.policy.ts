import type { PrismaClient } from '@prisma/client';

import { resolveJstBusinessDayRange9am, resolveJstSignageBusinessDate } from '../../../lib/signage-business-day.js';

export type RiggingInspectionBusinessDayMatch = {
  id: string;
  inspectedAt: Date;
};

export class RiggingInspectionDedupPolicy {
  constructor(private readonly client: PrismaClient) {}

  async findForBusinessDay(params: {
    riggingGearId: string;
    employeeId: string;
    inspectedAt: Date;
  }): Promise<RiggingInspectionBusinessDayMatch | null> {
    const businessDate = resolveJstSignageBusinessDate(params.inspectedAt);
    const { start, end } = resolveJstBusinessDayRange9am(businessDate);

    return this.client.riggingInspectionRecord.findFirst({
      where: {
        riggingGearId: params.riggingGearId,
        employeeId: params.employeeId,
        inspectedAt: {
          gte: start,
          lt: end,
        },
      },
      select: { id: true, inspectedAt: true },
    });
  }

  async existsForBusinessDay(params: {
    riggingGearId: string;
    employeeId: string;
    inspectedAt: Date;
  }): Promise<boolean> {
    const existing = await this.findForBusinessDay(params);
    return existing != null;
  }
}
