import { describe, expect, it, vi, beforeEach } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';

import { PhotoToolLabelReviewService } from '../photo-tool-label-review.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('PhotoToolLabelReviewService', () => {
  const employee = {
    id: 'emp-1',
    displayName: '山田',
    employeeCode: 'E001',
  };
  const baseLoan = {
    id: 'loan-1',
    borrowedAt: new Date('2025-01-01T00:00:00Z'),
    photoUrl: '/api/storage/photos/2025/01/x.jpg',
    photoToolDisplayName: 'ペンチ',
    photoToolHumanDisplayName: null as string | null,
    photoToolHumanQuality: null as 'GOOD' | 'MARGINAL' | 'BAD' | null,
    photoToolHumanReviewedAt: null as Date | null,
    itemId: null,
    photoTakenAt: new Date('2025-01-01T00:00:01Z'),
    employee,
    client: null,
  };

  beforeEach(() => {
    vi.mocked(prisma.loan.findMany).mockReset();
    vi.mocked(prisma.loan.findFirst).mockReset();
    vi.mocked(prisma.loan.update).mockReset();
  });

  it('listPhotoLabelReviews maps rows', async () => {
    vi.mocked(prisma.loan.findMany).mockResolvedValue([baseLoan] as never);
    const svc = new PhotoToolLabelReviewService();
    const rows = await svc.listPhotoLabelReviews(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'loan-1',
      photoUrl: baseLoan.photoUrl,
      photoToolDisplayName: 'ペンチ',
      employee: { displayName: '山田', employeeCode: 'E001' },
    });
  });

  it('submitReview updates quality and human display name', async () => {
    vi.mocked(prisma.loan.findFirst).mockResolvedValue(baseLoan as never);
    vi.mocked(prisma.loan.update).mockResolvedValue({
      ...baseLoan,
      photoToolHumanQuality: 'GOOD',
      photoToolHumanDisplayName: 'ラジオペンチ',
      photoToolHumanReviewedAt: new Date('2025-01-02T00:00:00Z'),
      photoToolHumanReviewedByUserId: 'user-1',
    } as never);

    const svc = new PhotoToolLabelReviewService();
    const row = await svc.submitReview({
      loanId: 'loan-1',
      reviewerUserId: 'user-1',
      quality: 'GOOD',
      humanDisplayNameUpdate: '  ラジオペンチ  ',
    });

    expect(prisma.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1' },
        data: expect.objectContaining({
          photoToolHumanQuality: 'GOOD',
          photoToolHumanReviewedByUserId: 'user-1',
          photoToolHumanDisplayName: 'ラジオペンチ',
        }),
      })
    );
    expect(row.photoToolHumanDisplayName).toBe('ラジオペンチ');
  });

  it('submitReview does not change human name when update omitted', async () => {
    vi.mocked(prisma.loan.findFirst).mockResolvedValue(baseLoan as never);
    vi.mocked(prisma.loan.update).mockResolvedValue({
      ...baseLoan,
      photoToolHumanQuality: 'MARGINAL',
    } as never);

    const svc = new PhotoToolLabelReviewService();
    await svc.submitReview({
      loanId: 'loan-1',
      reviewerUserId: 'user-1',
      quality: 'MARGINAL',
    });

    expect(prisma.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          photoToolHumanDisplayName: expect.anything(),
        }),
      })
    );
  });
});
