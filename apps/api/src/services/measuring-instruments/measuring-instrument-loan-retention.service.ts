import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

export type MeasuringInstrumentLoanRetentionResult = {
  deletedEvents: number;
  twoYearsAgo: number;
};

export class MeasuringInstrumentLoanRetentionService {
  async cleanupTwoYearsAgo(now: Date = new Date()): Promise<MeasuringInstrumentLoanRetentionResult> {
    const currentYear = now.getFullYear();
    const twoYearsAgo = currentYear - 2;

    const start = new Date(twoYearsAgo, 0, 1, 0, 0, 0, 0);
    const end = new Date(twoYearsAgo, 11, 31, 23, 59, 59, 999);

    const deleted = await prisma.measuringInstrumentLoanEvent.deleteMany({
      where: {
        eventAt: {
          gte: start,
          lte: end,
        },
      },
    });

    logger?.info(
      { twoYearsAgo, deletedEvents: deleted.count },
      '[MeasuringInstrumentLoanRetentionService] Cleanup completed'
    );

    return { deletedEvents: deleted.count, twoYearsAgo };
  }
}
