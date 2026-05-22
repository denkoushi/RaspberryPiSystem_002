import type { PrismaClient } from '@prisma/client';

import { resolveJstBusinessDayRange9am, resolveJstSignageBusinessDate } from '../../../lib/signage-business-day.js';

export class RiggingInspectionDedupPolicy {
  constructor(private readonly client: PrismaClient) {}

  async existsForBusinessDay(params: {
    riggingGearId: string;
    employeeId: string;
    inspectedAt: Date;
  }): Promise<boolean> {
    const businessDate = resolveJstSignageBusinessDate(params.inspectedAt);
    const { start, end } = resolveJstBusinessDayRange9am(businessDate);

    const existing = await this.client.riggingInspectionRecord.findFirst({
      where: {
        riggingGearId: params.riggingGearId,
        employeeId: params.employeeId,
        inspectedAt: {
          gte: start,
          lt: end,
        },
      },
      select: { id: true },
    });

    return existing != null;
  }
}
