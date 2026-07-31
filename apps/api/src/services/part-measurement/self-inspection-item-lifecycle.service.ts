import {
  Prisma,
  type PartMeasurementProcessGroup,
  type SelfInspectionItemInvalidation,
  type SelfInspectionItemInvalidationState
} from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveProductionSchedulePlannedQuantity } from '../production-schedule/self-inspection-schedule-eligibility.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import { tryResolveExpectedEntryCount } from './self-inspection-config.js';
import { SelfInspectionInvalidationAccessService } from './self-inspection-invalidation-access.service.js';
import {
  selfInspectionInvalidationConflict
} from './self-inspection-invalidation-errors.js';
import { lockSelfInspectionItemBusinessKey } from './self-inspection-item-lock.repository.js';
import { lockSessionRow } from './self-inspection/mutation-guards.js';
import {
  buildSessionBusinessKey,
  hasInspectionDrawingTemplate,
  normalizeText,
  templateConfigFromTemplate
} from './self-inspection/shared.js';

export const SELF_INSPECTION_INVALIDATION_LIST_MAX = 200;
export type SelfInspectionInvalidationActor = {
  username: string | null;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

export type SelfInspectionInvalidationTarget =
  | { kind: 'session'; sessionId: string }
  | {
      kind: 'schedule_row';
      scheduleRowId: string;
      templateId: string;
      productNo: string;
      processGroup: PartMeasurementProcessGroup;
      resourceCd: string;
      fseiban: string;
      fhincd: string;
      fhinmei: string;
    };

type TargetSnapshot = {
  itemBusinessKey: string;
  sessionId: string | null;
  scheduleRowId: string;
  templateId: string | null;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  plannedQuantity: number | null;
  expectedEntryCount: number | null;
  sourceState: SelfInspectionItemInvalidationState;
};

const sessionLifecycleInclude = {
  entries: {
    select: {
      id: true,
      values: {
        select: { reviewStatus: true }
      }
    }
  },
  recordApproval: { select: { id: true } }
} as const;

function conflict(message: string): ApiError {
  return selfInspectionInvalidationConflict(message);
}

function requireReason(value: string): string {
  const reason = value.trim();
  if (!reason) throw new ApiError(400, '削除理由が必要です');
  if (reason.length > 500) {
    throw new ApiError(400, '削除理由は500文字以内で入力してください');
  }
  return reason;
}

function readRowField(rowData: Prisma.JsonValue, key: string): string {
  const value = (rowData as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function assertSame(actual: string, expected: string, label: string): void {
  if (normalizeText(actual) !== normalizeText(expected)) {
    throw new ApiError(400, `日程行の${label}が削除対象と一致しません`);
  }
}

function sourceStateForSession(
  session: Prisma.SelfInspectionSessionGetPayload<{ include: typeof sessionLifecycleInclude }>
): SelfInspectionItemInvalidationState {
  if (session.recordApproval) return 'APPROVED';
  if (session.completedAt) return 'COMPLETED';
  if (
    session.recordApprovalRequiredAt ||
    session.inspectorRemeasurementRequiredAt ||
    session.entries.some((entry) =>
      entry.values.some((value) => value.reviewStatus === 'PENDING')
    )
  ) {
    return 'REVIEW_PENDING';
  }
  return session.entries.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

function assertIdempotentRequest(
  row: SelfInspectionItemInvalidation,
  target: SelfInspectionInvalidationTarget,
  reason: string
): void {
  const sameTarget =
    target.kind === 'session'
      ? row.sessionId === target.sessionId
      : row.scheduleRowId === normalizeText(target.scheduleRowId);
  if (!sameTarget || row.reason !== reason) {
    throw conflict('同じrequestIdを別の削除操作には使用できません');
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export class SelfInspectionItemLifecycleService {
  constructor(
    private readonly accessService = new SelfInspectionInvalidationAccessService()
  ) {}

  async invalidate(input: {
    target: SelfInspectionInvalidationTarget;
    requestId: string;
    accessPassword: string;
    reason: string;
    actor: SelfInspectionInvalidationActor;
  }): Promise<SelfInspectionItemInvalidation> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const reason = requireReason(input.reason);
    const requestId = input.requestId.trim();

    const existingRequest = await prisma.selfInspectionItemInvalidation.findUnique({
      where: { requestId }
    });
    if (existingRequest) {
      assertIdempotentRequest(existingRequest, input.target, reason);
      return existingRequest;
    }

    const seed = await this.resolveTargetSeed(input.target);

    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockSelfInspectionItemBusinessKey(tx, seed.itemBusinessKey);

        const requestAfterLock = await tx.selfInspectionItemInvalidation.findUnique({
          where: { requestId }
        });
        if (requestAfterLock) {
          assertIdempotentRequest(requestAfterLock, input.target, reason);
          return requestAfterLock;
        }

        const snapshot = await this.resolveLockedSnapshot(tx, input.target, seed);
        const existingInvalidation =
          await tx.selfInspectionItemInvalidation.findUnique({
            where: { itemBusinessKey: snapshot.itemBusinessKey }
          });
        if (existingInvalidation) {
          throw conflict('この自主検査アイテムは既に削除済みです');
        }

        const invalidatedAt = new Date();
        if (snapshot.sessionId) {
          await tx.selfInspectionSession.update({
            where: { id: snapshot.sessionId },
            data: { invalidatedAt }
          });
          await tx.selfInspectionPaperReport.updateMany({
            where: {
              sessionId: snapshot.sessionId,
              status: { in: ['ISSUED', 'OCR_REVIEW'] }
            },
            data: {
              status: 'CANCELLED',
              cancelledAt: invalidatedAt
            }
          });
        }

        return tx.selfInspectionItemInvalidation.create({
          data: {
            itemBusinessKey: snapshot.itemBusinessKey,
            requestId,
            sessionId: snapshot.sessionId,
            scheduleRowId: snapshot.scheduleRowId,
            sourceState: snapshot.sourceState,
            templateIdSnapshot: snapshot.templateId,
            productNoSnapshot: snapshot.productNo,
            processGroupSnapshot: snapshot.processGroup,
            resourceCdSnapshot: snapshot.resourceCd,
            fseibanSnapshot: snapshot.fseiban,
            fhincdSnapshot: snapshot.fhincd,
            fhinmeiSnapshot: snapshot.fhinmei,
            machineNameSnapshot: snapshot.machineName,
            plannedQuantitySnapshot: snapshot.plannedQuantity,
            expectedEntryCountSnapshot: snapshot.expectedEntryCount,
            reason,
            invalidatedByUsernameSnapshot: input.actor.username,
            invalidatedByClientDeviceId: input.actor.clientDeviceId,
            invalidatedByClientDeviceNameSnapshot:
              input.actor.clientDeviceNameSnapshot,
            invalidatedAt
          }
        });
      });
      resetSelfInspectionMachineBoardScheduleRowCaches();
      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw conflict(
          'このrequestIdまたは自主検査アイテムは既に別の削除操作で使用されています'
        );
      }
      throw error;
    }
  }

  async list(query: {
    productNo?: string;
    resourceCd?: string;
  }) {
    const productNo = normalizeText(query.productNo);
    const resourceCd = normalizeText(query.resourceCd);
    const rows = await prisma.selfInspectionItemInvalidation.findMany({
      where: {
        ...(productNo
          ? { productNoSnapshot: { contains: productNo, mode: 'insensitive' as const } }
          : {}),
        ...(resourceCd
          ? { resourceCdSnapshot: { equals: resourceCd, mode: 'insensitive' as const } }
          : {})
      },
      orderBy: [{ invalidatedAt: 'desc' }],
      take: SELF_INSPECTION_INVALIDATION_LIST_MAX + 1
    });
    return {
      invalidations: rows.slice(0, SELF_INSPECTION_INVALIDATION_LIST_MAX),
      listLimit: SELF_INSPECTION_INVALIDATION_LIST_MAX,
      truncated: rows.length > SELF_INSPECTION_INVALIDATION_LIST_MAX
    };
  }

  async getById(id: string) {
    const row = await prisma.selfInspectionItemInvalidation.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            template: {
              include: partMeasurementTemplateFullInclude
            },
            entries: {
              orderBy: { entryIndex: 'asc' },
              include: {
                values: {
                  orderBy: { createdAt: 'asc' },
                  include: { templateItem: true }
                },
                instrumentUsages: {
                  orderBy: { preUseInspectedAt: 'asc' }
                }
              }
            },
            inspectorEntries: {
              orderBy: { entryIndex: 'asc' },
              include: {
                values: {
                  orderBy: { createdAt: 'asc' },
                  include: { templateItem: true }
                },
                instrumentUsages: {
                  orderBy: { preUseInspectedAt: 'asc' }
                }
              }
            },
            recordApproval: true,
            measurementActorAuthentications: {
              orderBy: { authenticatedAt: 'asc' }
            },
            measurementOperations: {
              orderBy: { occurredAt: 'asc' }
            },
            paperReports: {
              orderBy: { issuedAt: 'desc' },
              include: {
                pages: {
                  orderBy: { pageNumber: 'asc' },
                  include: {
                    ocrReviews: {
                      orderBy: { createdAt: 'asc' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!row) {
      throw new ApiError(404, '削除済み自主検査の履歴が見つかりません');
    }
    return row;
  }

  private async resolveTargetSeed(
    target: SelfInspectionInvalidationTarget
  ): Promise<{ itemBusinessKey: string }> {
    if (target.kind === 'schedule_row') {
      return {
        itemBusinessKey: buildSessionBusinessKey({
          productNo: normalizeText(target.productNo),
          processGroup: target.processGroup,
          resourceCd: normalizeText(target.resourceCd),
          scheduleRowId: normalizeText(target.scheduleRowId)
        })
      };
    }
    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: target.sessionId },
      select: { sessionBusinessKey: true }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }
    return { itemBusinessKey: session.sessionBusinessKey };
  }

  private async resolveLockedSnapshot(
    tx: Prisma.TransactionClient,
    target: SelfInspectionInvalidationTarget,
    seed: { itemBusinessKey: string }
  ): Promise<TargetSnapshot> {
    const session = await tx.selfInspectionSession.findUnique({
      where: { sessionBusinessKey: seed.itemBusinessKey },
      include: sessionLifecycleInclude
    });
    if (session) {
      await lockSessionRow(tx, session.id);
      const locked = await tx.selfInspectionSession.findUnique({
        where: { id: session.id },
        include: sessionLifecycleInclude
      });
      if (!locked) throw new ApiError(404, '自主検査セッションが見つかりません');
      if (locked.invalidatedAt) {
        throw conflict('この自主検査アイテムは既に削除済みです');
      }
      this.assertSessionMatchesTarget(locked, target);
      return {
        itemBusinessKey: locked.sessionBusinessKey,
        sessionId: locked.id,
        scheduleRowId:
          normalizeText(locked.scheduleRowId) ||
          (target.kind === 'schedule_row' ? normalizeText(target.scheduleRowId) : ''),
        templateId: locked.templateId,
        productNo: locked.productNo,
        processGroup: locked.processGroup,
        resourceCd: locked.resourceCd,
        fseiban: locked.fseiban,
        fhincd: locked.fhincd,
        fhinmei: locked.fhinmei,
        machineName: locked.machineName,
        plannedQuantity: locked.plannedQuantity,
        expectedEntryCount: locked.expectedEntryCount,
        sourceState: sourceStateForSession(locked)
      };
    }
    if (target.kind !== 'schedule_row') {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }
    return this.resolveUnstartedScheduleSnapshot(tx, target, seed.itemBusinessKey);
  }

  private assertSessionMatchesTarget(
    session: {
      id: string;
      productNo: string;
      processGroup: PartMeasurementProcessGroup;
      resourceCd: string;
      scheduleRowId: string | null;
      fseiban: string | null;
      fhincd: string;
      fhinmei: string;
      templateId: string;
    },
    target: SelfInspectionInvalidationTarget
  ): void {
    if (target.kind === 'session') {
      if (session.id !== target.sessionId) {
        throw conflict('削除対象の自主検査セッションが更新されています');
      }
      return;
    }
    assertSame(session.productNo, target.productNo, '製造order');
    assertSame(session.resourceCd, target.resourceCd, '資源CD');
    assertSame(session.fseiban ?? '', target.fseiban, '製番');
    assertSame(session.fhincd, target.fhincd, '品番');
    assertSame(session.fhinmei, target.fhinmei, '品名');
    if (
      session.processGroup !== target.processGroup ||
      normalizeText(session.scheduleRowId) !== normalizeText(target.scheduleRowId) ||
      session.templateId !== target.templateId
    ) {
      throw new ApiError(400, '削除対象の自主検査情報が現在のセッションと一致しません');
    }
  }

  private async resolveUnstartedScheduleSnapshot(
    tx: Prisma.TransactionClient,
    target: Extract<SelfInspectionInvalidationTarget, { kind: 'schedule_row' }>,
    itemBusinessKey: string
  ): Promise<TargetSnapshot> {
    const row = await tx.csvDashboardRow.findFirst({
      where: {
        id: normalizeText(target.scheduleRowId),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
      }
    });
    if (!row) throw new ApiError(404, '日程行が見つかりません');
    assertSame(readRowField(row.rowData, 'ProductNo'), target.productNo, '製造order');
    assertSame(readRowField(row.rowData, 'FSIGENCD'), target.resourceCd, '資源CD');
    assertSame(readRowField(row.rowData, 'FSEIBAN'), target.fseiban, '製番');
    assertSame(readRowField(row.rowData, 'FHINCD'), target.fhincd, '品番');
    assertSame(readRowField(row.rowData, 'FHINMEI'), target.fhinmei, '品名');

    const template = await tx.partMeasurementTemplate.findFirst({
      where: {
        id: target.templateId,
        isActive: true,
        templateScope: 'THREE_KEY',
        processGroup: target.processGroup,
        resourceCd: normalizeText(target.resourceCd)
      },
      include: partMeasurementTemplateFullInclude
    });
    if (!template || !hasInspectionDrawingTemplate(template)) {
      throw new ApiError(409, '現在有効な自主検査テンプレートが見つかりません');
    }
    assertSame(template.fhincd, target.fhincd, '品番');
    const supplement = await tx.productionScheduleOrderSupplement.findFirst({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: normalizeText(target.scheduleRowId)
      },
      select: { plannedQuantity: true }
    });
    const plannedQuantity = resolveProductionSchedulePlannedQuantity(
      supplement?.plannedQuantity
    );
    if (plannedQuantity == null) {
      throw new ApiError(409, '指示数がないため自主検査アイテムを確認できません');
    }
    const expectedEntryCount = tryResolveExpectedEntryCount(
      templateConfigFromTemplate(template),
      plannedQuantity
    );
    if (expectedEntryCount == null) {
      throw new ApiError(409, '自主検査の必要件数を解決できません');
    }
    return {
      itemBusinessKey,
      sessionId: null,
      scheduleRowId: normalizeText(target.scheduleRowId),
      templateId: template.id,
      productNo: normalizeText(target.productNo),
      processGroup: target.processGroup,
      resourceCd: normalizeText(target.resourceCd),
      fseiban: normalizeText(target.fseiban) || null,
      fhincd: normalizeText(target.fhincd),
      fhinmei: normalizeText(target.fhinmei),
      machineName: null,
      plannedQuantity,
      expectedEntryCount,
      sourceState: 'NOT_STARTED'
    };
  }
}
