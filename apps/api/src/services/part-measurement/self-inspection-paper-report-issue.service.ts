import { Prisma, type PartMeasurementProcessGroup } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveProductionSchedulePlannedQuantity } from '../production-schedule/self-inspection-schedule-eligibility.js';
import { verifyProductionScheduleRowOrThrow } from '../production-schedule/verify-production-schedule-row.js';

import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';
import { SelfInspectionPaperQrCodec } from './self-inspection-paper-qr-codec.js';
import {
  buildSelfInspectionPaperReportPagePlans,
  assertTemplateSupportsSelfInspectionPaperReport
} from './self-inspection-paper-report-planner.js';
import {
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  tryResolveExpectedEntryCount,
  type SelfInspectionTemplateConfig
} from './self-inspection-config.js';

const paperReportPrintInclude = {
  session: true,
  template: {
    include: partMeasurementTemplateFullInclude
  },
  pages: {
    orderBy: { pageNumber: 'asc' as const }
  }
} as const;

export type SelfInspectionPaperReportForPrint = Prisma.SelfInspectionPaperReportGetPayload<{
  include: typeof paperReportPrintInclude;
}>;

export type IssueSelfInspectionPaperReportInput = {
  templateId: string;
  productNo: string;
  scheduleRowId: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  resourceCd: string;
  machineName?: string | null;
  clientDeviceId?: string | null;
};

export class SelfInspectionPaperReportIssueService {
  constructor(private readonly qrCodec = new SelfInspectionPaperQrCodec()) {}

  async issue(input: IssueSelfInspectionPaperReportInput): Promise<SelfInspectionPaperReportForPrint> {
    const template = await prisma.partMeasurementTemplate.findFirst({
      where: {
        id: input.templateId,
        isActive: true,
        templateScope: 'THREE_KEY'
      },
      include: partMeasurementTemplateFullInclude
    });
    if (!template) {
      throw new ApiError(404, '自主検査テンプレートが見つかりません');
    }
    assertTemplateSupportsSelfInspectionPaperReport(template);

    const productNo = normalizeText(input.productNo);
    const scheduleRowId = normalizeText(input.scheduleRowId);
    const fseiban = normalizeText(input.fseiban);
    const fhincd = normalizeText(input.fhincd);
    const fhinmei = normalizeText(input.fhinmei);
    const resourceCd = normalizeText(input.resourceCd);
    if (!productNo || !scheduleRowId || !fseiban || !fhincd || !fhinmei || !resourceCd) {
      throw new ApiError(400, '紙帳票発行に必要な日程行情報が不足しています');
    }
    if (fhincd !== normalizeText(template.fhincd)) {
      throw new ApiError(400, '品番がテンプレートと一致しません');
    }
    if (resourceCd !== normalizeText(template.resourceCd)) {
      throw new ApiError(400, '資源CDがテンプレートと一致しません');
    }

    await verifyProductionScheduleRowOrThrow(scheduleRowId, {
      productNo,
      fseiban,
      fhincd,
      resourceCd
    });

    const supplement = await prisma.productionScheduleOrderSupplement.findFirst({
      where: {
        csvDashboardRowId: scheduleRowId,
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
      },
      select: { plannedQuantity: true }
    });
    const plannedQuantity = resolveProductionSchedulePlannedQuantity(supplement?.plannedQuantity ?? null);
    if (plannedQuantity == null) {
      throw new ApiError(400, '指示数が補助データにないため紙帳票を発行できません');
    }
    if (plannedQuantity > SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
      throw new ApiError(400, `指示数は${SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT}以下である必要があります`);
    }

    const templateConfig = templateConfigFromTemplate(template);
    const expectedEntryCount = tryResolveExpectedEntryCount(templateConfig, plannedQuantity);
    if (expectedEntryCount == null) {
      throw new ApiError(409, '自主検査の必要件数を解決できません');
    }
    const pagePlans = buildSelfInspectionPaperReportPagePlans(template, plannedQuantity);
    const now = new Date();
    const sessionBusinessKey = buildSessionBusinessKey({
      productNo,
      processGroup: template.processGroup,
      resourceCd,
      scheduleRowId
    });

    const report = await prisma.$transaction(async (tx) => {
      const session = await tx.selfInspectionSession.upsert({
        where: { sessionBusinessKey },
        create: {
          sessionBusinessKey,
          templateId: template.id,
          productNo,
          processGroup: template.processGroup,
          resourceCd,
          scheduleRowId,
          fseiban,
          fhincd,
          fhinmei,
          machineName: normalizeText(input.machineName) || null,
          plannedQuantity,
          expectedEntryCount,
          clientDeviceId: input.clientDeviceId ?? null,
          startedAt: now
        },
        update: {},
        include: {
          template: true
        }
      });
      if (session.completedAt) {
        throw new ApiError(409, '完了済みの自主検査は紙帳票を再発行できません');
      }
      if (session.templateId !== template.id) {
        throw new ApiError(
          409,
          '既存の自主検査セッションのテンプレートと印刷テンプレートが異なります。リセット後に再発行してください。'
        );
      }

      await tx.selfInspectionPaperReport.updateMany({
        where: {
          scheduleRowId,
          status: { in: ['ISSUED', 'OCR_REVIEW'] }
        },
        data: {
          status: 'SUPERSEDED',
          supersededAt: now
        }
      });

      const created = await tx.selfInspectionPaperReport.create({
        data: {
          sessionId: session.id,
          scheduleRowId,
          templateId: template.id,
          status: 'ISSUED',
          issuedAt: now,
          clientDeviceId: input.clientDeviceId ?? null,
          plannedQuantity,
          templateVersion: template.version
        }
      });

      await tx.selfInspectionPaperReportPage.createMany({
        data: pagePlans.map((page) => {
          const pageCode = this.qrCodec.generatePageCode();
          return {
            reportId: created.id,
            pageCode,
            pageNumber: page.pageNumber,
            qrPayload: this.qrCodec.encode(pageCode),
            entryIndexFrom: page.entryIndexFrom,
            entryIndexTo: page.entryIndexTo,
            markerNoFrom: page.markerNoFrom,
            markerNoTo: page.markerNoTo
          };
        })
      });

      return tx.selfInspectionPaperReport.findUniqueOrThrow({
        where: { id: created.id },
        include: paperReportPrintInclude
      });
    });

    resetSelfInspectionMachineBoardScheduleRowCaches();
    return report;
  }

  async getPrintReport(reportId: string): Promise<SelfInspectionPaperReportForPrint> {
    const report = await prisma.selfInspectionPaperReport.findUnique({
      where: { id: reportId },
      include: paperReportPrintInclude
    });
    if (!report) {
      throw new ApiError(404, '紙帳票が見つかりません');
    }
    return report;
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function templateConfigFromTemplate(template: SelfInspectionTemplateConfig): SelfInspectionTemplateConfig {
  return {
    selfInspectionMode: template.selfInspectionMode,
    selfInspectionFixedCount: template.selfInspectionFixedCount ?? null,
    selfInspectionSampleSize: template.selfInspectionSampleSize ?? null
  };
}

function buildSessionBusinessKey(input: {
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string;
}): string {
  return [
    normalizeText(input.productNo),
    input.processGroup,
    normalizeText(input.resourceCd),
    normalizeText(input.scheduleRowId)
  ].join('::');
}
