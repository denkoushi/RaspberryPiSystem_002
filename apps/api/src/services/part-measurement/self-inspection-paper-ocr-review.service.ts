import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import type { SelfInspectionPaperOcrCandidateValue } from './self-inspection-paper-ocr.port.js';
import { SelfInspectionPaperReportResolver } from './self-inspection-paper-report-resolver.service.js';

export type CreateSelfInspectionPaperOcrReviewInput = {
  qrPayload: string;
  candidateValues: SelfInspectionPaperOcrCandidateValue[];
  imageStoragePath?: string | null;
};

export class SelfInspectionPaperOcrReviewService {
  constructor(private readonly resolver = new SelfInspectionPaperReportResolver()) {}

  async createReview(input: CreateSelfInspectionPaperOcrReviewInput) {
    const page = await this.resolver.assertResolvablePage(input.qrPayload);
    await this.resolver.assertPageNotConfirmed(page.id);

    const review = await prisma.$transaction(async (tx) => {
      if (page.report.status === 'ISSUED') {
        await tx.selfInspectionPaperReport.update({
          where: { id: page.reportId },
          data: { status: 'OCR_REVIEW' }
        });
      }

      return tx.selfInspectionPaperOcrReview.create({
        data: {
          reportId: page.reportId,
          pageId: page.id,
          status: 'OCR_REVIEW',
          qrPayload: input.qrPayload,
          imageStoragePath: input.imageStoragePath?.trim() || null,
          ocrCandidateValues: normalizeJson(input.candidateValues)
        }
      });
    });

    return {
      review,
      page
    };
  }
}

function normalizeJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    throw new ApiError(400, 'OCR候補値が必要です');
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
