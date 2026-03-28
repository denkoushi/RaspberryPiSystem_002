import { prisma } from '../../../lib/prisma.js';

import type { PendingPhotoLabelRepositoryPort, PendingPhotoLoanRow } from './photo-tool-label-ports.js';

export class PrismaPhotoToolLabelRepository implements PendingPhotoLabelRepositoryPort {
  async resetStaleClaims(staleBefore: Date): Promise<number> {
    const result = await prisma.loan.updateMany({
      where: {
        photoToolLabelRequested: true,
        photoToolDisplayName: null,
        photoToolLabelClaimedAt: { not: null, lt: staleBefore },
      },
      data: { photoToolLabelClaimedAt: null },
    });
    return result.count;
  }

  async listPendingLoans(limit: number): Promise<PendingPhotoLoanRow[]> {
    const rows = await prisma.loan.findMany({
      where: {
        photoToolLabelRequested: true,
        photoUrl: { not: null },
        photoToolDisplayName: null,
        photoToolLabelClaimedAt: null,
      },
      orderBy: { borrowedAt: 'asc' },
      take: limit,
      select: { id: true, photoUrl: true },
    });
    return rows.filter((r): r is PendingPhotoLoanRow => r.photoUrl != null);
  }

  async tryClaim(loanId: string): Promise<boolean> {
    const result = await prisma.loan.updateMany({
      where: {
        id: loanId,
        photoToolLabelRequested: true,
        photoUrl: { not: null },
        photoToolDisplayName: null,
        photoToolLabelClaimedAt: null,
      },
      data: { photoToolLabelClaimedAt: new Date() },
    });
    return result.count === 1;
  }

  async completeWithLabel(loanId: string, displayName: string): Promise<void> {
    await prisma.loan.update({
      where: { id: loanId },
      data: {
        photoToolDisplayName: displayName,
        photoToolLabelClaimedAt: null,
      },
    });
  }

  async releaseClaim(loanId: string): Promise<void> {
    await prisma.loan.updateMany({
      where: { id: loanId, photoToolDisplayName: null },
      data: { photoToolLabelClaimedAt: null },
    });
  }
}
