import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { SelfInspectionPaperQrCodec } from './self-inspection-paper-qr-codec.js';

const paperReportResolveInclude = {
  report: {
    include: {
      session: true
    }
  }
} as const;

export type SelfInspectionPaperReportResolveResult =
  | {
      valid: true;
      page: NonNullable<Awaited<ReturnType<SelfInspectionPaperReportResolver['loadPageByCode']>>>;
    }
  | {
      valid: false;
      reason: 'invalid_qr' | 'not_found' | 'superseded' | 'imported' | 'cancelled';
      message: string;
    };

export class SelfInspectionPaperReportResolver {
  constructor(private readonly qrCodec = new SelfInspectionPaperQrCodec()) {}

  async resolvePageQr(qrPayload: string): Promise<SelfInspectionPaperReportResolveResult> {
    const decoded = this.qrCodec.decode(qrPayload);
    if (!decoded.ok) {
      return {
        valid: false,
        reason: 'invalid_qr',
        message: '紙帳票QRの形式またはチェック文字が不正です'
      };
    }

    const page = await this.loadPageByCode(decoded.payload.pageCode);
    if (!page) {
      return {
        valid: false,
        reason: 'not_found',
        message: '紙帳票QRに対応する発行レコードが見つかりません'
      };
    }

    switch (page.report.status) {
      case 'SUPERSEDED':
        return {
          valid: false,
          reason: 'superseded',
          message: '再印刷により無効になった古い紙帳票です'
        };
      case 'IMPORTED':
        return {
          valid: false,
          reason: 'imported',
          message: 'この紙帳票は既に取込済みです'
        };
      case 'CANCELLED':
        return {
          valid: false,
          reason: 'cancelled',
          message: '取消済みの紙帳票です'
        };
      case 'ISSUED':
      case 'OCR_REVIEW':
      default:
        return { valid: true, page };
    }
  }

  async assertResolvablePage(qrPayload: string) {
    const resolved = await this.resolvePageQr(qrPayload);
    if (resolved.valid) {
      return resolved.page;
    }
    const status = resolved.reason === 'invalid_qr' ? 400 : resolved.reason === 'not_found' ? 404 : 409;
    throw new ApiError(status, resolved.message, { reason: resolved.reason });
  }

  async assertPageNotConfirmed(pageId: string): Promise<void> {
    const existing = await prisma.selfInspectionPaperOcrReview.findFirst({
      where: {
        pageId,
        status: 'CONFIRMED'
      },
      select: { id: true }
    });
    if (existing) {
      throw new ApiError(409, 'このページは既にOCR確認済みです');
    }
  }

  async loadPageByCode(pageCode: string) {
    return prisma.selfInspectionPaperReportPage.findUnique({
      where: { pageCode },
      include: paperReportResolveInclude
    });
  }
}
