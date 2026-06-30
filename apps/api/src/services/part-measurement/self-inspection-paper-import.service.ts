import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';
import { resolveSelfInspectionNfcTagUid } from './self-inspection-nfc-tag-resolve.js';
import {
  validateSelfInspectionPaperConfirmedValues,
  type SelfInspectionPaperConfirmedValueInput
} from './self-inspection-paper-measurement-values.js';
import {
  assertEntryIndexAllowed,
  inferEntrySlotKindForIndex,
  type SelfInspectionTemplateConfig
} from './self-inspection-config.js';
import { markSelfInspectionRecordApprovalRequiredAfterMeasurementSave } from './self-inspection-record-approval-saved-gate.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';

export type ConfirmSelfInspectionPaperOcrReviewInput = {
  values: SelfInspectionPaperConfirmedValueInput[];
  employeeTagUid?: string | null;
  measuringInstrumentTagUid?: string | null;
  confirmedByActorId?: string | null;
  confirmedByActorName?: string | null;
};

type RegistrationPatch = {
  createdByEmployeeId?: string;
  createdByEmployeeNameSnapshot?: string;
  measuringInstrumentId?: string;
  measuringInstrumentManagementNumberSnapshot?: string;
  measuringInstrumentNameSnapshot?: string;
  measuringInstrumentTagUidSnapshot?: string;
};

export class SelfInspectionPaperImportService {
  async confirmReview(reviewId: string, input: ConfirmSelfInspectionPaperOcrReviewInput) {
    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.selfInspectionPaperOcrReview.findUnique({
        where: { id: reviewId },
        include: {
          report: true,
          page: true
        }
      });
      if (!review) {
        throw new ApiError(404, 'OCR確認レコードが見つかりません');
      }
      if (review.status === 'CONFIRMED') {
        throw new ApiError(409, 'このOCR確認レコードは既に確定済みです');
      }
      if (review.status === 'CANCELLED') {
        throw new ApiError(409, '取消済みのOCR確認レコードです');
      }
      if (review.report.status === 'SUPERSEDED') {
        throw new ApiError(409, '再印刷により無効になった古い紙帳票です');
      }
      if (review.report.status === 'IMPORTED') {
        throw new ApiError(409, 'この紙帳票は既に取込済みです');
      }
      if (review.report.status === 'CANCELLED') {
        throw new ApiError(409, '取消済みの紙帳票です');
      }

      await this.lockSessionRow(tx, review.report.sessionId);
      const session = await tx.selfInspectionSession.findUnique({
        where: { id: review.report.sessionId },
        include: {
          template: { include: partMeasurementTemplateFullInclude }
        }
      });
      if (!session) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      if (session.completedAt) {
        throw new ApiError(409, '完了済みの自主検査は編集できません');
      }

      const templateConfig = templateConfigFromSession(session);
      const values = validateSelfInspectionPaperConfirmedValues(session.template.items, input.values);
      for (const value of values) {
        assertEntryIndexAllowed(templateConfig, session.plannedQuantity, value.entryIndex);
      }
      const registrationPatch = await this.resolveRegistrationPatch(input);
      const valuesByEntry = groupBy(values, (value) => value.entryIndex);

      for (const [entryIndex, entryValues] of valuesByEntry) {
        const existingEntry = await tx.selfInspectionLotEntry.findUnique({
          where: {
            sessionId_entryIndex: {
              sessionId: session.id,
              entryIndex
            }
          },
          include: { values: true }
        });

        if (!existingEntry) {
          const slotKind = inferEntrySlotKindForIndex(
            templateConfig,
            session.plannedQuantity,
            entryIndex
          );
          await tx.selfInspectionLotEntry.create({
            data: {
              sessionId: session.id,
              entryIndex,
              entrySlotKind: slotKind,
              ...registrationPatch,
              values: {
                create: entryValues.map((value) => ({
                  templateItemId: value.templateItemId,
                  value: value.value
                }))
              }
            }
          });
          continue;
        }

        const existingValueByItem = new Map(
          existingEntry.values.map((value) => [value.templateItemId, value])
        );
        for (const value of entryValues) {
          const existingValue = existingValueByItem.get(value.templateItemId);
          if (!existingValue) {
            await tx.selfInspectionMeasurementValue.create({
              data: {
                entryId: existingEntry.id,
                templateItemId: value.templateItemId,
                value: value.value
              }
            });
            continue;
          }
          if (existingValue.value?.equals(value.value)) {
            continue;
          }
          if (!value.overwriteExisting) {
            throw new ApiError(
              409,
              '既にデジタル入力済みの測定値があります。上書きを確認してください。'
            );
          }
          await tx.selfInspectionMeasurementValue.update({
            where: { id: existingValue.id },
            data: { value: value.value }
          });
        }

        if (Object.keys(registrationPatch).length > 0) {
          await tx.selfInspectionLotEntry.update({
            where: { id: existingEntry.id },
            data: registrationPatch
          });
        }
      }

      await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, session.id);

      const confirmedValues = serializeConfirmedValues(values);
      const confirmed = await tx.selfInspectionPaperOcrReview.update({
        where: { id: review.id },
        data: {
          status: 'CONFIRMED',
          confirmedValues,
          confirmedByActorId: input.confirmedByActorId?.trim() || null,
          confirmedByActorName: input.confirmedByActorName?.trim() || null,
          confirmedAt: new Date()
        }
      });

      const allPagesImported = await this.areAllReportPagesConfirmed(tx, review.reportId);
      const report = await tx.selfInspectionPaperReport.update({
        where: { id: review.reportId },
        data: allPagesImported
          ? { status: 'IMPORTED', importedAt: new Date() }
          : { status: 'OCR_REVIEW' }
      });

      return {
        review: confirmed,
        report
      };
    });

    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  private async lockSessionRow(db: Prisma.TransactionClient, sessionId: string): Promise<void> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SelfInspectionSession" WHERE id = ${sessionId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }
  }

  private async resolveRegistrationPatch(
    input: Pick<ConfirmSelfInspectionPaperOcrReviewInput, 'employeeTagUid' | 'measuringInstrumentTagUid'>
  ): Promise<RegistrationPatch> {
    const patch: RegistrationPatch = {};
    const employeeTag = input.employeeTagUid?.trim();
    if (employeeTag) {
      const result = await resolveSelfInspectionNfcTagUid(employeeTag);
      if (result.kind !== 'employee') {
        throw new ApiError(400, '測定者タグとして登録済みの従業員タグが必要です');
      }
      patch.createdByEmployeeId = result.employee.id;
      patch.createdByEmployeeNameSnapshot = result.employee.displayName;
    }

    const instrumentTag = input.measuringInstrumentTagUid?.trim();
    if (instrumentTag) {
      const result = await resolveSelfInspectionNfcTagUid(instrumentTag);
      if (result.kind !== 'instrument') {
        throw new ApiError(400, '計測機器タグとして登録済みのタグが必要です');
      }
      patch.measuringInstrumentId = result.instrument.id;
      patch.measuringInstrumentManagementNumberSnapshot = result.instrument.managementNumber;
      patch.measuringInstrumentNameSnapshot = result.instrument.name;
      patch.measuringInstrumentTagUidSnapshot = result.instrument.tagUid;
    }
    return patch;
  }

  private async areAllReportPagesConfirmed(
    db: Prisma.TransactionClient,
    reportId: string
  ): Promise<boolean> {
    const [pageCount, confirmedReviews] = await Promise.all([
      db.selfInspectionPaperReportPage.count({ where: { reportId } }),
      db.selfInspectionPaperOcrReview.findMany({
        where: {
          reportId,
          status: 'CONFIRMED',
          pageId: { not: null }
        },
        select: { pageId: true }
      })
    ]);
    const confirmedPageIds = new Set(confirmedReviews.map((review) => review.pageId));
    return pageCount > 0 && confirmedPageIds.size >= pageCount;
  }
}

function templateConfigFromSession(session: {
  template: {
    selfInspectionMode: import('@prisma/client').SelfInspectionMode;
    selfInspectionFixedCount: number | null;
    selfInspectionSampleSize: number | null;
  };
}): SelfInspectionTemplateConfig {
  return {
    selfInspectionMode: session.template.selfInspectionMode,
    selfInspectionFixedCount: session.template.selfInspectionFixedCount,
    selfInspectionSampleSize: session.template.selfInspectionSampleSize
  };
}

function groupBy<T, K>(values: T[], keyFn: (value: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const list = grouped.get(key);
    if (list) {
      list.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }
  return grouped;
}

function serializeConfirmedValues(
  values: Array<{
    entryIndex: number;
    templateItemId: string;
    value: Prisma.Decimal;
    overwriteExisting: boolean;
  }>
): Prisma.InputJsonValue {
  return values.map((value) => ({
    entryIndex: value.entryIndex,
    templateItemId: value.templateItemId,
    value: value.value.toString(),
    overwriteExisting: value.overwriteExisting
  }));
}
