import type { PartMeasurementProcessGroup } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from './part-measurement-constants.js';

export function normalizePartMeasurementSessionResourceCd(raw: string): string {
  const t = raw.trim();
  if (t.length === 0) return PART_MEASUREMENT_LEGACY_RESOURCE_CD;
  return t;
}

/**
 * 同一測定対象セッション（製造order・工程・資源CD）のライフサイクル。
 * シート側の CRUD とは責務を分離する（親の完了判定・一意キー）。
 */
export class PartMeasurementSessionService {
  normalizeBusinessKeyParts(
    productNo: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    return {
      productNo: productNo.trim(),
      processGroup,
      resourceCd: normalizePartMeasurementSessionResourceCd(resourceCd)
    };
  }

  async findByBusinessKey(
    productNo: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    const k = this.normalizeBusinessKeyParts(productNo, processGroup, resourceCd);
    return prisma.partMeasurementSession.findUnique({
      where: { productNo_processGroup_resourceCd: k }
    });
  }

  async ensureSession(
    productNo: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    const k = this.normalizeBusinessKeyParts(productNo, processGroup, resourceCd);
    return prisma.partMeasurementSession.upsert({
      where: { productNo_processGroup_resourceCd: k },
      create: k,
      update: {}
    });
  }

  /** 同一セッション内で同じテンプレは1枚までとする（下書き・確定を問わず）。 */
  async assertTemplateUniqueInSession(sessionId: string, templateId: string, excludeSheetId?: string | null) {
    const existing = await prisma.partMeasurementSheet.findFirst({
      where: {
        sessionId,
        templateId,
        ...(excludeSheetId ? { id: { not: excludeSheetId } } : {})
      },
      select: { id: true }
    });
    if (existing) {
      throw new ApiError(
        409,
        'この測定対象には既に同じテンプレの記録表があります',
        undefined,
        'PART_MEASUREMENT_TEMPLATE_ALREADY_IN_SESSION'
      );
    }
  }

  /**
   * 親の可算完了: 取消・無効以外の記録表が1枚以上あり、かつすべて確定しているとき completedAt をセット。
   * 下書きが残る場合は null に戻す。
   */
  async refreshCompletedAt(sessionId: string) {
    const sheets = await prisma.partMeasurementSheet.findMany({
      where: { sessionId },
      select: { status: true }
    });
    const hasDraft = sheets.some((s) => s.status === 'DRAFT');
    if (hasDraft) {
      await prisma.partMeasurementSession.update({ where: { id: sessionId }, data: { completedAt: null } });
      return;
    }
    const relevant = sheets.filter((s) => s.status !== 'CANCELLED' && s.status !== 'INVALIDATED');
    if (relevant.length === 0) {
      await prisma.partMeasurementSession.update({ where: { id: sessionId }, data: { completedAt: null } });
      return;
    }
    const allFinalized = relevant.every((s) => s.status === 'FINALIZED');
    if (allFinalized) {
      await prisma.partMeasurementSession.update({
        where: { id: sessionId },
        data: { completedAt: new Date() }
      });
    } else {
      await prisma.partMeasurementSession.update({ where: { id: sessionId }, data: { completedAt: null } });
    }
  }
}
