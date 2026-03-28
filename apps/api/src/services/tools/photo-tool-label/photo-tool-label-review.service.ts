import type { PhotoToolHumanLabelQuality } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';

import { normalizePhotoToolDisplayName } from './photo-tool-label-normalize.js';

const PHOTO_LOAN_REVIEW_LIST_LIMIT_MAX = 100;

export type PhotoLabelReviewListRow = {
  id: string;
  borrowedAt: Date;
  photoUrl: string;
  photoToolDisplayName: string | null;
  photoToolHumanDisplayName: string | null;
  photoToolHumanQuality: PhotoToolHumanLabelQuality | null;
  photoToolHumanReviewedAt: Date | null;
  employee: { id: string; displayName: string; employeeCode: string };
  client: { id: string; name: string; location: string | null } | null;
};

export class PhotoToolLabelReviewService {
  async listPhotoLabelReviews(limit: number): Promise<PhotoLabelReviewListRow[]> {
    const take = Math.min(Math.max(limit, 1), PHOTO_LOAN_REVIEW_LIST_LIMIT_MAX);
    const loans = await prisma.loan.findMany({
      where: {
        photoUrl: { not: null },
        itemId: null,
        photoTakenAt: { not: null },
      },
      include: {
        employee: true,
        client: true,
      },
      orderBy: { borrowedAt: 'desc' },
      take,
    });

    return loans
      .filter((row): row is typeof row & { photoUrl: string; employee: NonNullable<typeof row.employee> } =>
        Boolean(row.photoUrl && row.employee)
      )
      .map((row) => ({
        id: row.id,
        borrowedAt: row.borrowedAt,
        photoUrl: row.photoUrl!,
        photoToolDisplayName: row.photoToolDisplayName,
        photoToolHumanDisplayName: row.photoToolHumanDisplayName,
        photoToolHumanQuality: row.photoToolHumanQuality,
        photoToolHumanReviewedAt: row.photoToolHumanReviewedAt,
        employee: {
          id: row.employee.id,
          displayName: row.employee.displayName,
          employeeCode: row.employee.employeeCode,
        },
        client: row.client
          ? { id: row.client.id, name: row.client.name, location: row.client.location }
          : null,
      }));
  }

  /**
   * @param humanDisplayNameUpdate undefined のとき `photoToolHumanDisplayName` は変更しない
   */
  async submitReview(input: {
    loanId: string;
    reviewerUserId: string;
    quality: PhotoToolHumanLabelQuality;
    humanDisplayNameUpdate?: string | null;
  }): Promise<PhotoLabelReviewListRow> {
    const loan = await prisma.loan.findFirst({
      where: { id: input.loanId },
      include: { employee: true, client: true },
    });

    if (!loan) {
      throw new ApiError(404, '貸出が見つかりません');
    }
    if (!loan.photoUrl || loan.itemId != null || !loan.photoTakenAt) {
      throw new ApiError(400, '写真持出の貸出ではありません');
    }
    if (!loan.employee) {
      throw new ApiError(400, '従業員情報がありません');
    }

    let photoToolHumanDisplayName: string | null | undefined;
    if (input.humanDisplayNameUpdate !== undefined) {
      if (input.humanDisplayNameUpdate === null || input.humanDisplayNameUpdate.trim() === '') {
        photoToolHumanDisplayName = null;
      } else {
        const normalized = normalizePhotoToolDisplayName(input.humanDisplayNameUpdate);
        if (!normalized) {
          throw new ApiError(400, '表示名が空です');
        }
        photoToolHumanDisplayName = normalized;
      }
    }

    const updated = await prisma.loan.update({
      where: { id: loan.id },
      data: {
        photoToolHumanQuality: input.quality,
        photoToolHumanReviewedAt: new Date(),
        photoToolHumanReviewedByUserId: input.reviewerUserId,
        ...(photoToolHumanDisplayName !== undefined ? { photoToolHumanDisplayName } : {}),
      },
      include: { employee: true, client: true },
    });

    if (!updated.photoUrl || !updated.employee) {
      throw new ApiError(500, '更新後のデータが不正です');
    }

    return {
      id: updated.id,
      borrowedAt: updated.borrowedAt,
      photoUrl: updated.photoUrl,
      photoToolDisplayName: updated.photoToolDisplayName,
      photoToolHumanDisplayName: updated.photoToolHumanDisplayName,
      photoToolHumanQuality: updated.photoToolHumanQuality,
      photoToolHumanReviewedAt: updated.photoToolHumanReviewedAt,
      employee: {
        id: updated.employee.id,
        displayName: updated.employee.displayName,
        employeeCode: updated.employee.employeeCode,
      },
      client: updated.client
        ? { id: updated.client.id, name: updated.client.name, location: updated.client.location }
        : null,
    };
  }
}
