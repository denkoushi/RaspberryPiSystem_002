import { Prisma } from '@prisma/client';
import type {
  PartMeasurementProcessGroup,
  SelfInspectionMeasurementReviewStatus,
  SelfInspectionMode
} from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleGrindingResourceCd
} from '../production-schedule/policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { SPLIT_DISPLAY_ITEM_ID_PREFIX } from '../production-schedule/order-split/leaderboard-display-item-id.js';
import { resolveProductionSchedulePlannedQuantity } from '../production-schedule/self-inspection-schedule-eligibility.js';
import { verifyProductionScheduleRowOrThrow } from '../production-schedule/verify-production-schedule-row.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';
import { assertMeasuringInstrumentAvailableForSelfInspection } from './self-inspection-measuring-instrument-eligibility.js';
import { assertSelfInspectionEntryRegistrationTagUids } from './self-inspection-registration-tag-validation.js';
import { collectParticipantEmployeeNames } from './self-inspection-participant-names.js';
import { loadParticipantEmployeeNamesBySessionIds } from './self-inspection-participant-names.query.js';
import { isSelfInspectionLotEntryRegistrationComplete } from './self-inspection-nfc-tag-resolve.js';

import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import {
  assertEntryIndexAllowed,
  entrySlotLabelFromKind,
  inferEntrySlotKindForIndex,
  isFullSelfInspectionPlannedQuantityWithinLimit,
  isSessionCompletionReady,
  listRequiredEntrySlots,
  resolveTemplateFixedCount,
  serializeEntrySlotKind,
  serializeSelfInspectionMode,
  tryResolveExpectedEntryCount,
  type SelfInspectionTemplateConfig,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT
} from './self-inspection-config.js';
import {
  assertSelfInspectionResetConfirmation,
  buildRestartPayloadFromSessionSnapshot,
  buildSessionResetSnapshot,
  hasInspectionDrawingTemplateForReset,
  resolveExpectedEntryCountForReset,
  SELF_INSPECTION_RESET_ACTION_TYPE,
  templateConfigFromTemplateForReset
} from './self-inspection-reset-preflight.js';

export const LIST_SESSIONS_MAX = 200;

const listSessionsSummaryInclude = {
  template: {
    select: {
      name: true,
      selfInspectionMode: true,
      selfInspectionFixedCount: true,
      selfInspectionSampleSize: true
    }
  },
  entries: {
    select: {
      entryIndex: true
    }
  },
  _count: { select: { entries: true } }
} as const;

const recordApprovalSessionInclude = {
  template: { include: partMeasurementTemplateFullInclude },
  entries: {
    orderBy: { entryIndex: 'asc' },
    select: {
      id: true,
      entryIndex: true,
      entrySlotKind: true,
      createdByEmployeeId: true,
      createdByEmployeeNameSnapshot: true,
      measuringInstrumentId: true,
      measuringInstrumentManagementNumberSnapshot: true,
      measuringInstrumentNameSnapshot: true,
      measuringInstrumentTagUidSnapshot: true,
      createdAt: true,
      updatedAt: true,
      values: {
        select: {
          id: true,
          templateItemId: true,
          value: true,
          reviewStatus: true,
          outOfToleranceAcknowledgedAt: true,
          approvedAt: true,
          updatedAt: true
        }
      }
    }
  },
  recordApproval: true,
  _count: { select: { entries: true } }
} as const;

type SessionSummarySource = Prisma.SelfInspectionSessionGetPayload<{
  include: typeof listSessionsSummaryInclude;
}>;

type RecordApprovalSessionSource = Prisma.SelfInspectionSessionGetPayload<{
  include: typeof recordApprovalSessionInclude;
}>;

export {
  isFullSelfInspectionPlannedQuantityWithinLimit,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  tryResolveExpectedEntryCount
};

type SelfInspectionTemplate = Prisma.PartMeasurementTemplateGetPayload<{
  include: typeof partMeasurementTemplateFullInclude;
}>;

type SessionWithCounts = Prisma.SelfInspectionSessionGetPayload<{
  include: {
    template: {
      include: typeof partMeasurementTemplateFullInclude;
    };
    entries: {
      select: {
        entryIndex: true;
      };
    };
    _count: {
      select: {
        entries: true;
      };
    };
  };
}>;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function isBlankValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

function countDecimalPlacesString(raw: string): number {
  const s = raw.trim();
  const i = s.indexOf('.');
  if (i < 0) return 0;
  return s.length - i - 1;
}

function assertDecimalPlacesWithinLimit(decimalValue: Prisma.Decimal, decimalPlaces: number): void {
  const quantized = decimalValue.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
  if (!decimalValue.equals(quantized)) {
    throw new ApiError(400, `小数桁数は最大${decimalPlaces}桁です`);
  }
}

function isValueWithinTolerance(
  item: { lowerLimit: Prisma.Decimal | null; upperLimit: Prisma.Decimal | null },
  decimalValue: Prisma.Decimal
): boolean {
  if (item.lowerLimit == null || item.upperLimit == null) {
    return false;
  }
  const lower = item.lowerLimit;
  const upper = item.upperLimit;
  const lo = lower.lessThanOrEqualTo(upper) ? lower : upper;
  const hi = lower.lessThanOrEqualTo(upper) ? upper : lower;
  return decimalValue.greaterThanOrEqualTo(lo) && decimalValue.lessThanOrEqualTo(hi);
}

function parseDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Prisma.Decimal(String(value));
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new Prisma.Decimal(trimmed);
  } catch {
    return null;
  }
}

function hasInspectionDrawingTemplate(template: SelfInspectionTemplate): boolean {
  if (!template.isActive || !template.visualTemplate?.drawingImageRelativePath?.trim()) return false;
  return template.items.length > 0 && template.items.every((item) => {
    return item.markerXRatio != null && item.markerYRatio != null && item.lowerLimit != null && item.upperLimit != null;
  });
}

function serializeProcessGroup(processGroup: PartMeasurementProcessGroup): 'cutting' | 'grinding' {
  return processGroup === 'GRINDING' ? 'grinding' : 'cutting';
}

function templateConfigFromTemplate(template: {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount?: number | null;
  selfInspectionSampleSize?: number | null;
}): SelfInspectionTemplateConfig {
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

export function pickSessionForScheduleRow<
  T extends { scheduleRowId: string | null; completedAt: Date | null; updatedAt: Date }
>(sessions: T[], scheduleRowId: string): T | null {
  const candidates = sessions.filter((session) => session.scheduleRowId === scheduleRowId);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.completedAt && !b.completedAt) return 1;
    if (!a.completedAt && b.completedAt) return -1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0] ?? null;
}

export type SelfInspectionSessionForDecoration = {
  id: string;
  scheduleRowId: string | null;
  templateId: string;
  plannedQuantity: number;
  expectedEntryCount: number;
  completedAt: Date | null;
  updatedAt: Date;
  pendingReviewCount?: number;
  entries: Array<{ entryIndex: number }>;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount: number | null;
    selfInspectionSampleSize: number | null;
  };
  _count: { entries: number };
};

export type SelfInspectionDecorationCache = {
  policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>;
  templateByKey: Map<string, SelfInspectionTemplate>;
  /** 値 null = 問い合わせ済み・セッションなし（negative cache） */
  sessionsByScheduleRowId: Map<string, SelfInspectionSessionForDecoration | null>;
};

function templateKeyForRow(
  fhincd: string,
  processGroup: PartMeasurementProcessGroup,
  resourceCd: string
): string {
  return `${fhincd}::${processGroup}::${resourceCd}`;
}

/** 装飾用キャッシュ。テンプレは resourceCds 指定時のみ資源で絞って preload し、それ以外は行キー単位で ensure する。 */
export async function createSelfInspectionDecorationCache(scope?: {
  siteKey?: string;
  resourceCds?: string[];
}): Promise<SelfInspectionDecorationCache> {
  const policy = await getResourceCategoryPolicy({ siteKey: scope?.siteKey });
  const normalizedResourceCds = (scope?.resourceCds ?? [])
    .map((cd) => normalizeText(cd))
    .filter((cd) => cd.length > 0);
  const templateByKey = new Map<string, SelfInspectionTemplate>();
  if (normalizedResourceCds.length > 0) {
    const templates = await prisma.partMeasurementTemplate.findMany({
      where: {
        isActive: true,
        templateScope: 'THREE_KEY',
        resourceCd: { in: normalizedResourceCds }
      },
      include: partMeasurementTemplateFullInclude
    });
    for (const template of templates) {
      if (!hasInspectionDrawingTemplate(template)) {
        continue;
      }
      templateByKey.set(
        templateKeyForRow(template.fhincd, template.processGroup, template.resourceCd),
        template
      );
    }
  }
  return {
    policy,
    templateByKey,
    sessionsByScheduleRowId: new Map()
  };
}

export async function ensureSelfInspectionTemplatesForRows(
  cache: SelfInspectionDecorationCache,
  rows: Array<{ rowData: Prisma.JsonValue }>
): Promise<void> {
  const missingKeys = new Map<string, { fhincd: string; processGroup: PartMeasurementProcessGroup; resourceCd: string }>();
  for (const row of rows) {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = normalizeText(String(rowData.FSIGENCD ?? ''));
    const fhincd = normalizeText(String(rowData.FHINCD ?? ''));
    if (!resourceCd || !fhincd) continue;
    const processGroup = isProductionScheduleGrindingResourceCd(resourceCd, cache.policy) ? 'GRINDING' : 'CUTTING';
    const key = templateKeyForRow(fhincd, processGroup, resourceCd);
    if (!cache.templateByKey.has(key) && !missingKeys.has(key)) {
      missingKeys.set(key, { fhincd, processGroup, resourceCd });
    }
  }
  if (missingKeys.size === 0) {
    return;
  }
  const templates = await prisma.partMeasurementTemplate.findMany({
    where: {
      isActive: true,
      templateScope: 'THREE_KEY',
      OR: [...missingKeys.values()].map((key) => ({
        fhincd: key.fhincd,
        processGroup: key.processGroup,
        resourceCd: key.resourceCd
      }))
    },
    include: partMeasurementTemplateFullInclude
  });
  for (const template of templates) {
    if (!hasInspectionDrawingTemplate(template)) {
      continue;
    }
    cache.templateByKey.set(
      templateKeyForRow(template.fhincd, template.processGroup, template.resourceCd),
      template
    );
  }
}

export async function ensureSelfInspectionSessionsInCache(
  cache: SelfInspectionDecorationCache,
  scheduleRowIds: string[]
): Promise<void> {
  const missingIds = scheduleRowIds.filter((id) => id.length > 0 && !cache.sessionsByScheduleRowId.has(id));
  if (missingIds.length === 0) {
    return;
  }
  const sessions = await prisma.selfInspectionSession.findMany({
    where: { scheduleRowId: { in: missingIds } },
    include: {
      template: {
        select: {
          selfInspectionMode: true,
          selfInspectionFixedCount: true,
          selfInspectionSampleSize: true,
        },
      },
      entries: {
        select: {
          entryIndex: true,
        },
      },
      _count: { select: { entries: true } },
    },
  });
  const pendingReviewCounts = await loadPendingReviewCountsBySessionIds(
    prisma,
    sessions.map((session) => session.id)
  );
  const foundScheduleRowIds = new Set<string>();
  for (const rawSession of sessions) {
    const session = {
      ...rawSession,
      pendingReviewCount: pendingReviewCounts.get(rawSession.id) ?? 0
    };
    if (!session.scheduleRowId) {
      continue;
    }
    foundScheduleRowIds.add(session.scheduleRowId);
    const existing = cache.sessionsByScheduleRowId.get(session.scheduleRowId);
    if (!existing) {
      cache.sessionsByScheduleRowId.set(session.scheduleRowId, session);
      continue;
    }
    const merged = pickSessionForScheduleRow([existing, session], session.scheduleRowId);
    if (merged) {
      cache.sessionsByScheduleRowId.set(session.scheduleRowId, merged);
    }
  }
  for (const scheduleRowId of missingIds) {
    if (!foundScheduleRowIds.has(scheduleRowId)) {
      cache.sessionsByScheduleRowId.set(scheduleRowId, null);
    }
  }
}

function buildStartPath(input: {
  templateId: string;
  productNo: string;
  processGroup: 'cutting' | 'grinding';
  resourceCd: string;
  scheduleRowId: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName?: string | null;
}): string {
  const params = new URLSearchParams({
    templateId: input.templateId,
    productNo: input.productNo,
    processGroup: input.processGroup,
    resourceCd: input.resourceCd,
    fhincd: input.fhincd,
    fhinmei: input.fhinmei
  });
  params.set('scheduleRowId', input.scheduleRowId);
  params.set('fseiban', input.fseiban);
  if (input.machineName) params.set('machineName', input.machineName);
  return `/kiosk/part-measurement/self-inspection/start?${params.toString()}`;
}

type SessionForEntryCountPolicy = {
  expectedEntryCount: number;
  plannedQuantity: number;
  template: SelfInspectionTemplateConfig;
};

function isMisalignedLegacyFullSelfInspectionSession(session: SessionForEntryCountPolicy): boolean {
  if (session.template.selfInspectionMode !== 'FULL') {
    return false;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned == null) {
    return false;
  }
  return session.expectedEntryCount < planned;
}

/** 旧形式で指示数が上限超・必要件数が食い違うセッション（再作成が必要） */
export function resolveLegacyFullSelfInspectionBlockedReason(
  session: SessionForEntryCountPolicy
): string | null {
  if (!isMisalignedLegacyFullSelfInspectionSession(session)) {
    return null;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned != null && planned > SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
    return (
      `このセッションは旧形式のため、指示数 ${planned} 件の全数検査を完了できません。` +
      '生産日程から自主検査をやり直し、新しいセッションを作成してください。'
    );
  }
  return null;
}

/** 入力件の上限・完了判定の必要件数（修復後は expected と一致） */
export function resolveRequiredEntryCountForCompletion(session: SessionForEntryCountPolicy): number {
  if (session.template.selfInspectionMode !== 'FULL') {
    return session.expectedEntryCount;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned == null) {
    return session.expectedEntryCount;
  }
  return Math.max(session.expectedEntryCount, planned);
}

function enrichSessionEntryCountFields<
  T extends SessionForEntryCountPolicy & { completedEntryCount?: number }
>(session: T) {
  const requiredEntryCount = resolveRequiredEntryCountForCompletion(session);
  return {
    requiredEntryCount,
    entryCountBlockedReason: resolveLegacyFullSelfInspectionBlockedReason(session)
  };
}

async function loadPendingReviewCountsBySessionIds(
  db: Prisma.TransactionClient | typeof prisma,
  sessionIds: string[]
): Promise<Map<string, number>> {
  const uniqueSessionIds = [...new Set(sessionIds.filter((id) => id.trim().length > 0))];
  if (uniqueSessionIds.length === 0) {
    return new Map();
  }
  const rows = await db.selfInspectionMeasurementValue.findMany({
    where: {
      reviewStatus: 'PENDING',
      entry: {
        sessionId: { in: uniqueSessionIds }
      }
    },
    select: {
      entry: {
        select: {
          sessionId: true
        }
      }
    }
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sessionId = row.entry.sessionId;
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }
  return counts;
}

function assertEntryUnmodifiedSince(ifUnmodifiedSince: string, entryUpdatedAt: Date): void {
  const clientAt = new Date(ifUnmodifiedSince);
  if (Number.isNaN(clientAt.getTime())) {
    throw new ApiError(400, 'ifUnmodifiedSince の形式が不正です');
  }
  if (clientAt.getTime() !== entryUpdatedAt.getTime()) {
    throw new ApiError(409, '他端末で更新されています。再読み込みしてください。');
  }
}

function resolveExpectedEntryCount(template: SelfInspectionTemplateConfig, plannedQuantity: number): number {
  const count = tryResolveExpectedEntryCount(template, plannedQuantity);
  if (count != null) {
    return count;
  }
  throw new ApiError(400, '自主検査の必要件数を決定できません');
}

type SelfInspectionStatusDto = 'not_started' | 'in_progress' | 'review_pending' | 'completed';

type SelfInspectionMeasurementPayloadValue = {
  templateItemId: string;
  value: string | number | null;
  outOfToleranceAcknowledged?: boolean;
};

type ExistingMeasurementReviewValue = {
  templateItemId: string;
  value: Prisma.Decimal | null;
  reviewStatus: SelfInspectionMeasurementReviewStatus;
  outOfToleranceAcknowledgedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  approvedByUsername: string | null;
  approvalComment: string | null;
};

type NormalizedMeasurementValue = {
  templateItemId: string;
  value: Prisma.Decimal;
  reviewStatus: SelfInspectionMeasurementReviewStatus;
  outOfToleranceAcknowledgedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  approvedByUsername: string | null;
  approvalComment: string | null;
};

function resolveStatus(input: {
  completedEntryCount: number;
  completedAt: Date | null;
  pendingReviewCount?: number;
  entryIndices?: number[];
  completionPolicy?: SessionForEntryCountPolicy;
}): SelfInspectionStatusDto {
  const {
    completedEntryCount,
    completedAt,
    pendingReviewCount = 0,
    entryIndices,
    completionPolicy
  } = input;
  if (completedAt) return 'completed';
  if (completedEntryCount <= 0) return 'not_started';
  if (pendingReviewCount > 0 && entryIndices && completionPolicy) {
    const templateConfig = templateConfigFromTemplate(completionPolicy.template);
    if (isSessionCompletionReady(templateConfig, completionPolicy.plannedQuantity, entryIndices)) {
      return 'review_pending';
    }
  }
  return 'in_progress';
}

type LeaderboardSelfInspectionDecoration = {
  id: string;
  hasSelfInspectionDrawing: boolean;
  selfInspectionTemplateId: string | null;
  selfInspectionStatus: SelfInspectionStatusDto | null;
  selfInspectionEntryPath: string | null;
  resolvedPlannedQuantity?: number | null;
  resolvedRequiredEntryCount?: number | null;
  completedEntryCount?: number | null;
  pendingReviewCount?: number | null;
};

function emptyLeaderboardSelfInspectionDecoration(rowId: string): LeaderboardSelfInspectionDecoration {
  return {
    id: rowId,
    hasSelfInspectionDrawing: false,
    selfInspectionTemplateId: null,
    selfInspectionStatus: null,
    selfInspectionEntryPath: null
  };
}

/** 既存セッションは現行テンプレ有無に関わらず再開導線を出す */
function buildLeaderboardDecorationFromSession(
  rowId: string,
  session: SelfInspectionSessionForDecoration,
  plannedQuantity: number | null
): LeaderboardSelfInspectionDecoration {
  const planned =
    plannedQuantity ?? resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  const policy = {
    expectedEntryCount: session.expectedEntryCount,
    plannedQuantity: session.plannedQuantity,
    template: templateConfigFromTemplate(session.template),
  };
  return {
    id: rowId,
    hasSelfInspectionDrawing: true,
    selfInspectionTemplateId: session.templateId,
    selfInspectionStatus: resolveStatus({
      completedEntryCount: session._count.entries,
      completedAt: session.completedAt,
      pendingReviewCount: session.pendingReviewCount ?? 0,
      entryIndices: session.entries.map((entry) => entry.entryIndex),
      completionPolicy: policy
    }),
    selfInspectionEntryPath: `/kiosk/part-measurement/self-inspection/sessions/${session.id}`,
    resolvedPlannedQuantity: planned,
    resolvedRequiredEntryCount: resolveRequiredEntryCountForCompletion(policy),
    completedEntryCount: session._count.entries,
    pendingReviewCount: session.pendingReviewCount ?? 0,
  };
}

function sessionForEntryCountPolicy(session: {
  expectedEntryCount: number;
  plannedQuantity: number;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
  };
}): SessionForEntryCountPolicy {
  return {
    expectedEntryCount: session.expectedEntryCount,
    plannedQuantity: session.plannedQuantity,
    template: templateConfigFromTemplate(session.template)
  };
}

function serializeResetNewSession(session: {
  id: string;
  templateId: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string | null;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
}) {
  return {
    id: session.id,
    templateId: session.templateId,
    productNo: session.productNo,
    processGroup: serializeProcessGroup(session.processGroup),
    resourceCd: session.resourceCd,
    scheduleRowId: session.scheduleRowId,
    fseiban: session.fseiban,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    machineName: session.machineName,
    plannedQuantity: session.plannedQuantity,
    expectedEntryCount: session.expectedEntryCount
  };
}

function serializeSessionSummary(
  session: SessionSummarySource | SessionWithCounts,
  participantEmployeeNames: string[] = [],
  pendingReviewCount = 0
) {
  const policy = sessionForEntryCountPolicy(session);
  const completedEntryCount = session._count.entries;
  const status = resolveStatus({
    completedEntryCount,
    completedAt: session.completedAt,
    pendingReviewCount,
    entryIndices: 'entries' in session ? session.entries.map((entry) => entry.entryIndex) : undefined,
    completionPolicy: policy
  });
  const templateConfig = templateConfigFromTemplate(session.template);
  return {
    id: session.id,
    sessionBusinessKey: session.sessionBusinessKey,
    templateId: session.templateId,
    templateName: session.template.name,
    productNo: session.productNo,
    fseiban: session.fseiban,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    processGroup: serializeProcessGroup(session.processGroup),
    resourceCd: session.resourceCd,
    scheduleRowId: session.scheduleRowId,
    machineName: session.machineName,
    plannedQuantity: session.plannedQuantity,
    expectedEntryCount: session.expectedEntryCount,
    ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
    completedEntryCount,
    pendingReviewCount,
    participantEmployeeNames,
    selfInspectionMode: serializeSelfInspectionMode(session.template.selfInspectionMode),
    selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
    selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
    status,
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
    updatedAt: session.updatedAt.toISOString()
  };
}

async function serializeSessionSummaryWithAggregatedParticipantNames(
  session: SessionSummarySource | SessionWithCounts
) {
  const [participantNamesBySessionId, pendingReviewCounts] = await Promise.all([
    loadParticipantEmployeeNamesBySessionIds([session.id]),
    loadPendingReviewCountsBySessionIds(prisma, [session.id])
  ]);
  return serializeSessionSummary(
    session,
    participantNamesBySessionId.get(session.id) ?? [],
    pendingReviewCounts.get(session.id) ?? 0
  );
}

export type SelfInspectionRecordApprovalState =
  | 'input_incomplete'
  | 'registration_incomplete'
  | 'approvable'
  | 'approved';

export type SelfInspectionApproverResolveResult =
  | {
      kind: 'employee';
      employee: {
        id: string;
        employeeCode: string;
        displayName: string;
        nfcTagUid: string;
      };
    }
  | { kind: 'unknown' }
  | { kind: 'inactive'; status: string }
  | { kind: 'instrument' }
  | { kind: 'duplicate' };

function serializeRecordApproval(approval: RecordApprovalSessionSource['recordApproval']) {
  if (!approval) return null;
  return {
    id: approval.id,
    approvedAt: approval.approvedAt.toISOString(),
    approverEmployeeId: approval.approverEmployeeId,
    approverEmployeeCodeSnapshot: approval.approverEmployeeCodeSnapshot,
    approverEmployeeNameSnapshot: approval.approverEmployeeNameSnapshot,
    approverEmployeeNfcTagUidSnapshot: approval.approverEmployeeNfcTagUidSnapshot,
    comment: approval.comment,
    clientDeviceId: approval.clientDeviceId,
    clientDeviceNameSnapshot: approval.clientDeviceNameSnapshot
  };
}

function pendingReviewCountFromRecordApprovalSession(session: RecordApprovalSessionSource): number {
  let count = 0;
  for (const entry of session.entries) {
    count += entry.values.filter((value) => value.reviewStatus === 'PENDING').length;
  }
  return count;
}

function buildRecordApprovalReadiness(session: RecordApprovalSessionSource): {
  state: SelfInspectionRecordApprovalState;
  requiredEntryCount: number;
  completedRequiredEntryCount: number;
  missingRequiredEntryCount: number;
  incompleteValueEntryCount: number;
  incompleteRegistrationEntryCount: number;
  pendingReviewCount: number;
} {
  const requiredSlots = listRequiredEntrySlots(
    templateConfigFromTemplate(session.template),
    session.plannedQuantity
  );
  const entriesByIndex = new Map(session.entries.map((entry) => [entry.entryIndex, entry]));
  let completedRequiredEntryCount = 0;
  let missingRequiredEntryCount = 0;
  let incompleteValueEntryCount = 0;
  let incompleteRegistrationEntryCount = 0;

  for (const slot of requiredSlots) {
    const entry = entriesByIndex.get(slot.entryIndex);
    if (!entry) {
      missingRequiredEntryCount += 1;
      continue;
    }
    completedRequiredEntryCount += 1;
    const valuesByItemId = new Map(entry.values.map((value) => [value.templateItemId, value]));
    const hasMissingValue = session.template.items.some((item) => {
      const stored = valuesByItemId.get(item.id);
      return stored?.value == null;
    });
    if (hasMissingValue) {
      incompleteValueEntryCount += 1;
    }
    if (!isSelfInspectionLotEntryRegistrationComplete(entry)) {
      incompleteRegistrationEntryCount += 1;
    }
  }

  const pendingReviewCount = pendingReviewCountFromRecordApprovalSession(session);
  const state: SelfInspectionRecordApprovalState = session.recordApproval
    ? 'approved'
    : missingRequiredEntryCount > 0 || incompleteValueEntryCount > 0 || requiredSlots.length === 0
      ? 'input_incomplete'
      : incompleteRegistrationEntryCount > 0
        ? 'registration_incomplete'
        : 'approvable';

  return {
    state,
    requiredEntryCount: requiredSlots.length,
    completedRequiredEntryCount,
    missingRequiredEntryCount,
    incompleteValueEntryCount,
    incompleteRegistrationEntryCount,
    pendingReviewCount
  };
}

function serializeRecordApprovalSessionListItem(session: RecordApprovalSessionSource) {
  const readiness = buildRecordApprovalReadiness(session);
  const summary = serializeSessionSummary(
    session,
    collectParticipantEmployeeNames(session.entries),
    readiness.pendingReviewCount
  );
  return {
    ...summary,
    recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
    recordApprovalState: readiness.state,
    recordApproval: serializeRecordApproval(session.recordApproval),
    requiredEntryCount: readiness.requiredEntryCount,
    completedRequiredEntryCount: readiness.completedRequiredEntryCount,
    missingRequiredEntryCount: readiness.missingRequiredEntryCount,
    incompleteValueEntryCount: readiness.incompleteValueEntryCount,
    incompleteRegistrationEntryCount: readiness.incompleteRegistrationEntryCount
  };
}

function serializeRecordApprovalEntryDetail(
  session: RecordApprovalSessionSource,
  slot: ReturnType<typeof listRequiredEntrySlots>[number]
) {
  const entry = session.entries.find((row) => row.entryIndex === slot.entryIndex) ?? null;
  const valuesByItemId = new Map((entry?.values ?? []).map((value) => [value.templateItemId, value]));
  const values = session.template.items.map((item) => {
    const stored = valuesByItemId.get(item.id) ?? null;
    const numericValue = stored?.value ?? null;
    return {
      id: stored?.id ?? null,
      templateItemId: item.id,
      displayMarker: item.displayMarker,
      datumSurface: item.datumSurface,
      measurementPoint: item.measurementPoint,
      measurementLabel: item.measurementLabel,
      unit: item.unit,
      value: numericValue != null ? String(numericValue) : null,
      lowerLimit: item.lowerLimit != null ? String(item.lowerLimit) : null,
      upperLimit: item.upperLimit != null ? String(item.upperLimit) : null,
      isWithinTolerance: numericValue != null ? isValueWithinTolerance(item, numericValue) : null,
      reviewStatus: stored?.reviewStatus ?? null,
      outOfToleranceAcknowledgedAt: stored?.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
      approvedAt: stored?.approvedAt?.toISOString() ?? null,
      updatedAt: stored?.updatedAt.toISOString() ?? null
    };
  });
  const hasMissingValue = values.some((value) => value.value == null);
  const registrationComplete = entry ? isSelfInspectionLotEntryRegistrationComplete(entry) : false;
  const state = !entry || hasMissingValue
    ? 'input_incomplete'
    : !registrationComplete
      ? 'registration_incomplete'
      : 'ready';
  return {
    entryIndex: slot.entryIndex,
    entrySlotKind: slot.entrySlotKind,
    entrySlotLabel: slot.entrySlotLabel,
    state,
    entry: entry
      ? {
          id: entry.id,
          createdByEmployeeId: entry.createdByEmployeeId,
          createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
          measuringInstrumentId: entry.measuringInstrumentId,
          measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
          measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
          measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString()
        }
      : null,
    values
  };
}

export class SelfInspectionService {
  private async resolveEntryActor(employeeTagUid?: string | null): Promise<{
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
  }> {
    const tag = (employeeTagUid ?? '').trim();
    if (!tag) {
      return { createdByEmployeeId: null, createdByEmployeeNameSnapshot: null };
    }
    const employee = await prisma.employee.findFirst({
      where: { nfcTagUid: tag }
    });
    if (!employee) {
      throw new ApiError(404, '従業員が登録されていません');
    }
    return {
      createdByEmployeeId: employee.id,
      createdByEmployeeNameSnapshot: employee.displayName
    };
  }

  private async resolveEntryActorRequired(employeeTagUid?: string | null): Promise<{
    createdByEmployeeId: string;
    createdByEmployeeNameSnapshot: string;
  }> {
    const tag = (employeeTagUid ?? '').trim();
    if (!tag) {
      throw new ApiError(400, '測定者のNFCタグが必要です');
    }
    const resolved = await this.resolveEntryActor(tag);
    return {
      createdByEmployeeId: resolved.createdByEmployeeId!,
      createdByEmployeeNameSnapshot: resolved.createdByEmployeeNameSnapshot!
    };
  }

  private async resolveMeasuringInstrumentByTag(measuringInstrumentTagUid?: string | null): Promise<{
    measuringInstrumentId: string;
    measuringInstrumentManagementNumberSnapshot: string;
    measuringInstrumentNameSnapshot: string;
    measuringInstrumentTagUidSnapshot: string;
  }> {
    const tag = (measuringInstrumentTagUid ?? '').trim();
    if (!tag) {
      throw new ApiError(400, '測定機器のNFCタグが必要です');
    }
    const instrumentTag = await prisma.measuringInstrumentTag.findUnique({
      where: { rfidTagUid: tag },
      include: { measuringInstrument: true }
    });
    if (!instrumentTag?.measuringInstrument) {
      throw new ApiError(404, '計測機器が登録されていません');
    }
    assertMeasuringInstrumentAvailableForSelfInspection(instrumentTag.measuringInstrument);
    return {
      measuringInstrumentId: instrumentTag.measuringInstrument.id,
      measuringInstrumentManagementNumberSnapshot: instrumentTag.measuringInstrument.managementNumber,
      measuringInstrumentNameSnapshot: instrumentTag.measuringInstrument.name,
      measuringInstrumentTagUidSnapshot: tag
    };
  }

  private entryRegistrationFromRow(entry: {
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
  }) {
    return {
      createdByEmployeeId: entry.createdByEmployeeId,
      createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
      measuringInstrumentId: entry.measuringInstrumentId,
      measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
      measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
      measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot
    };
  }

  private async resolveRegistrationForCreateEntry(
    existingEntry: {
      createdByEmployeeId: string | null;
      createdByEmployeeNameSnapshot: string | null;
      measuringInstrumentId: string | null;
      measuringInstrumentManagementNumberSnapshot: string | null;
      measuringInstrumentNameSnapshot: string | null;
      measuringInstrumentTagUidSnapshot: string | null;
    } | null,
    input: {
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
      createdByEmployeeId?: string | null;
      createdByEmployeeNameSnapshot?: string | null;
    }
  ) {
    const isNew = !existingEntry;
    let createdByEmployeeId = existingEntry?.createdByEmployeeId ?? null;
    let createdByEmployeeNameSnapshot = existingEntry?.createdByEmployeeNameSnapshot ?? null;
    let measuringInstrumentId = existingEntry?.measuringInstrumentId ?? null;
    let measuringInstrumentManagementNumberSnapshot =
      existingEntry?.measuringInstrumentManagementNumberSnapshot ?? null;
    let measuringInstrumentNameSnapshot = existingEntry?.measuringInstrumentNameSnapshot ?? null;
    let measuringInstrumentTagUidSnapshot = existingEntry?.measuringInstrumentTagUidSnapshot ?? null;

    const pendingEmployeeTag = !createdByEmployeeId ? (input.employeeTagUid ?? '').trim() : '';
    const pendingInstrumentTag = !measuringInstrumentId ? (input.measuringInstrumentTagUid ?? '').trim() : '';
    await assertSelfInspectionEntryRegistrationTagUids({
      employeeTagUid: pendingEmployeeTag || null,
      measuringInstrumentTagUid: pendingInstrumentTag || null
    });

    if (!createdByEmployeeId) {
      if (input.createdByEmployeeId != null || input.createdByEmployeeNameSnapshot != null) {
        createdByEmployeeId = input.createdByEmployeeId ?? null;
        createdByEmployeeNameSnapshot = normalizeText(input.createdByEmployeeNameSnapshot) || null;
      } else if ((input.employeeTagUid ?? '').trim()) {
        const actor = await this.resolveEntryActorRequired(input.employeeTagUid);
        createdByEmployeeId = actor.createdByEmployeeId;
        createdByEmployeeNameSnapshot = actor.createdByEmployeeNameSnapshot;
      } else if (isNew) {
        throw new ApiError(400, '測定者のNFCタグが必要です');
      }
    }

    if (!measuringInstrumentId) {
      if ((input.measuringInstrumentTagUid ?? '').trim()) {
        const instrument = await this.resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
        measuringInstrumentId = instrument.measuringInstrumentId;
        measuringInstrumentManagementNumberSnapshot =
          instrument.measuringInstrumentManagementNumberSnapshot;
        measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
        measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
      } else if (isNew) {
        throw new ApiError(400, '測定機器のNFCタグが必要です');
      }
    }

    return {
      createdByEmployeeId,
      createdByEmployeeNameSnapshot,
      measuringInstrumentId,
      measuringInstrumentManagementNumberSnapshot,
      measuringInstrumentNameSnapshot,
      measuringInstrumentTagUidSnapshot
    };
  }

  private buildRegistrationBackfillData(
    existingEntry: {
      createdByEmployeeId: string | null;
      createdByEmployeeNameSnapshot: string | null;
      measuringInstrumentId: string | null;
      measuringInstrumentManagementNumberSnapshot: string | null;
      measuringInstrumentNameSnapshot: string | null;
      measuringInstrumentTagUidSnapshot: string | null;
    },
    resolved: {
      createdByEmployeeId: string | null;
      createdByEmployeeNameSnapshot: string | null;
      measuringInstrumentId: string | null;
      measuringInstrumentManagementNumberSnapshot: string | null;
      measuringInstrumentNameSnapshot: string | null;
      measuringInstrumentTagUidSnapshot: string | null;
    }
  ) {
    const data: {
      createdByEmployeeId?: string;
      createdByEmployeeNameSnapshot?: string;
      measuringInstrumentId?: string;
      measuringInstrumentManagementNumberSnapshot?: string;
      measuringInstrumentNameSnapshot?: string;
      measuringInstrumentTagUidSnapshot?: string;
    } = {};
    if (!existingEntry.createdByEmployeeId && resolved.createdByEmployeeId) {
      data.createdByEmployeeId = resolved.createdByEmployeeId;
      data.createdByEmployeeNameSnapshot = resolved.createdByEmployeeNameSnapshot ?? undefined;
    }
    if (!existingEntry.measuringInstrumentId && resolved.measuringInstrumentId) {
      data.measuringInstrumentId = resolved.measuringInstrumentId;
      data.measuringInstrumentManagementNumberSnapshot =
        resolved.measuringInstrumentManagementNumberSnapshot ?? undefined;
      data.measuringInstrumentNameSnapshot = resolved.measuringInstrumentNameSnapshot ?? undefined;
      data.measuringInstrumentTagUidSnapshot = resolved.measuringInstrumentTagUidSnapshot ?? undefined;
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  private async resolveRegistrationPatchForUpdate(
    existingEntry: {
      createdByEmployeeId: string | null;
      createdByEmployeeNameSnapshot: string | null;
      measuringInstrumentId: string | null;
      measuringInstrumentManagementNumberSnapshot: string | null;
      measuringInstrumentNameSnapshot: string | null;
      measuringInstrumentTagUidSnapshot: string | null;
    },
    input: {
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
    }
  ) {
    const patch: {
      createdByEmployeeId?: string;
      createdByEmployeeNameSnapshot?: string;
      measuringInstrumentId?: string;
      measuringInstrumentManagementNumberSnapshot?: string;
      measuringInstrumentNameSnapshot?: string;
      measuringInstrumentTagUidSnapshot?: string;
    } = {};

    const pendingEmployeeTag = !existingEntry.createdByEmployeeId ? (input.employeeTagUid ?? '').trim() : '';
    const pendingInstrumentTag = !existingEntry.measuringInstrumentId
      ? (input.measuringInstrumentTagUid ?? '').trim()
      : '';
    await assertSelfInspectionEntryRegistrationTagUids({
      employeeTagUid: pendingEmployeeTag || null,
      measuringInstrumentTagUid: pendingInstrumentTag || null
    });

    if (!existingEntry.createdByEmployeeId) {
      const actor = await this.resolveEntryActorRequired(input.employeeTagUid);
      patch.createdByEmployeeId = actor.createdByEmployeeId;
      patch.createdByEmployeeNameSnapshot = actor.createdByEmployeeNameSnapshot;
    }

    if (!existingEntry.measuringInstrumentId) {
      const instrument = await this.resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
      patch.measuringInstrumentId = instrument.measuringInstrumentId;
      patch.measuringInstrumentManagementNumberSnapshot =
        instrument.measuringInstrumentManagementNumberSnapshot;
      patch.measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
      patch.measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
    }

    return patch;
  }

  async resolveOrCreateSession(input: {
    templateId: string;
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId: string;
    fseiban: string;
    fhincd?: string | null;
    fhinmei?: string | null;
    machineName?: string | null;
    clientDeviceId?: string | null;
  }) {
    const productNo = normalizeText(input.productNo);
    const resourceCd = normalizeText(input.resourceCd);
    if (!productNo || !resourceCd) {
      throw new ApiError(400, '製造order と資源CDが必要です');
    }
    const template = await prisma.partMeasurementTemplate.findFirst({
      where: {
        id: input.templateId,
        isActive: true,
        processGroup: input.processGroup,
        resourceCd,
        templateScope: 'THREE_KEY'
      },
      include: partMeasurementTemplateFullInclude
    });
    if (!template) {
      throw new ApiError(404, '自主検査テンプレートが見つかりません');
    }
    if (!hasInspectionDrawingTemplate(template)) {
      throw new ApiError(409, '自主検査対象の検査図面テンプレートではありません');
    }
    const fhincdInput = normalizeText(input.fhincd);
    const fhincd = fhincdInput || template.fhincd;
    if (fhincdInput && fhincdInput !== normalizeText(template.fhincd)) {
      throw new ApiError(400, '品番がテンプレートと一致しません');
    }
    const fhinmei = normalizeText(input.fhinmei);
    if (!fhincd || !fhinmei) {
      throw new ApiError(400, '品番と品名が必要です');
    }
    const scheduleRowId = normalizeText(input.scheduleRowId);
    if (!scheduleRowId) {
      throw new ApiError(400, '日程行IDが必要です');
    }
    const fseiban = normalizeText(input.fseiban);
    if (!fseiban) {
      throw new ApiError(400, '製番が必要です');
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
      throw new ApiError(400, '指示数が補助データにないため自主検査を開始できません');
    }
    const expectedEntryCount = resolveExpectedEntryCount(
      templateConfigFromTemplate(template),
      plannedQuantity
    );
    const sessionBusinessKey = buildSessionBusinessKey({
      productNo,
      processGroup: input.processGroup,
      resourceCd,
      scheduleRowId
    });

    const sessionInclude = {
      template: { include: partMeasurementTemplateFullInclude },
      entries: { select: { entryIndex: true } },
      recordApproval: { select: { id: true } },
      _count: { select: { entries: true } }
    } as const;

    const session = await prisma.selfInspectionSession.upsert({
      where: { sessionBusinessKey },
      create: {
        sessionBusinessKey,
        templateId: template.id,
        productNo,
        processGroup: input.processGroup,
        resourceCd,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei,
        machineName: normalizeText(input.machineName) || null,
        plannedQuantity,
        expectedEntryCount,
        clientDeviceId: input.clientDeviceId ?? null,
        startedAt: new Date(),
        recordApprovalRequiredAt: new Date()
      },
      update: {},
      include: sessionInclude
    });

    return serializeSessionSummaryWithAggregatedParticipantNames(session);
  }

  async listSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    status?: SelfInspectionStatusDto;
  }) {
    const productNo = normalizeText(query.productNo);
    const resourceCd = normalizeText(query.resourceCd);
    if (!productNo && !resourceCd && query.status !== 'in_progress' && query.status !== 'review_pending') {
      throw new ApiError(400, '製造order または資源CDのいずれかで絞り込んでください');
    }
    const rows = await prisma.selfInspectionSession.findMany({
      where: {
        ...(productNo ? { productNo: { contains: productNo, mode: 'insensitive' } } : {}),
        ...(resourceCd ? { resourceCd: { equals: resourceCd, mode: 'insensitive' } } : {}),
        ...(query.processGroup ? { processGroup: query.processGroup } : {}),
        ...(query.status === 'not_started' ? { entries: { none: {} } } : {}),
        ...(query.status === 'in_progress'
          ? { completedAt: null, entries: { some: {} } }
          : {}),
        ...(query.status === 'review_pending'
          ? {
              completedAt: null,
              entries: { some: { values: { some: { reviewStatus: 'PENDING' } } } }
            }
          : {}),
        ...(query.status === 'completed' ? { completedAt: { not: null } } : {})
      },
      include: listSessionsSummaryInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: LIST_SESSIONS_MAX + 1
    });
    const truncated = rows.length > LIST_SESSIONS_MAX;
    const boundedRows = truncated ? rows.slice(0, LIST_SESSIONS_MAX) : rows;
    const sessionIds = boundedRows.map((row) => row.id);
    const [participantNamesBySessionId, pendingReviewCounts] = await Promise.all([
      loadParticipantEmployeeNamesBySessionIds(sessionIds),
      loadPendingReviewCountsBySessionIds(prisma, sessionIds)
    ]);
    const summaries = boundedRows.map((row) =>
      serializeSessionSummary(
        row,
        participantNamesBySessionId.get(row.id) ?? [],
        pendingReviewCounts.get(row.id) ?? 0
      )
    );
    const sessions =
      query.status === 'in_progress'
        ? summaries.filter((row) => row.status === 'in_progress')
      : query.status === 'completed'
        ? summaries.filter((row) => row.status === 'completed')
        : query.status === 'review_pending'
          ? summaries.filter((row) => row.status === 'review_pending')
        : summaries;
    return {
      sessions,
      listLimit: LIST_SESSIONS_MAX,
      truncated
    };
  }

  async listRecordApprovalSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    state?: 'active' | SelfInspectionRecordApprovalState;
  }) {
    const productNo = normalizeText(query.productNo);
    const resourceCd = normalizeText(query.resourceCd);
    const state = query.state ?? 'active';
    const rows = await prisma.selfInspectionSession.findMany({
      where: {
        recordApprovalRequiredAt: { not: null },
        ...(productNo ? { productNo: { contains: productNo, mode: 'insensitive' } } : {}),
        ...(resourceCd ? { resourceCd: { equals: resourceCd, mode: 'insensitive' } } : {}),
        ...(query.processGroup ? { processGroup: query.processGroup } : {}),
        ...(state === 'approved'
          ? { recordApproval: { isNot: null } }
          : { completedAt: null, recordApproval: { is: null } })
      },
      include: recordApprovalSessionInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: LIST_SESSIONS_MAX + 1
    });
    const truncated = rows.length > LIST_SESSIONS_MAX;
    const boundedRows = truncated ? rows.slice(0, LIST_SESSIONS_MAX) : rows;
    const sessions = boundedRows
      .map((row) => serializeRecordApprovalSessionListItem(row))
      .filter((row) => state === 'active' || row.recordApprovalState === state);
    return {
      sessions,
      listLimit: LIST_SESSIONS_MAX,
      truncated
    };
  }

  async getRecordApprovalSessionDetail(sessionId: string) {
    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: recordApprovalSessionInclude
    });
    if (!session || !session.recordApprovalRequiredAt) {
      throw new ApiError(404, '検査記録承認対象の自主検査セッションが見つかりません');
    }
    const summary = serializeRecordApprovalSessionListItem(session);
    const requiredSlots = listRequiredEntrySlots(
      templateConfigFromTemplate(session.template),
      session.plannedQuantity
    );
    return {
      ...summary,
      requiredEntries: requiredSlots.map((slot) => serializeRecordApprovalEntryDetail(session, slot))
    };
  }

  async resolveRecordApprovalApprover(rawUid: string): Promise<SelfInspectionApproverResolveResult> {
    const uid = rawUid.trim();
    if (!uid) {
      return { kind: 'unknown' };
    }
    const [employee, instrumentTag] = await Promise.all([
      prisma.employee.findFirst({
        where: { nfcTagUid: uid },
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          nfcTagUid: true,
          status: true
        }
      }),
      prisma.measuringInstrumentTag.findUnique({
        where: { rfidTagUid: uid },
        select: { id: true }
      })
    ]);
    const hasEmployee = Boolean(employee?.nfcTagUid);
    const hasInstrument = Boolean(instrumentTag);
    if (hasEmployee && hasInstrument) {
      return { kind: 'duplicate' };
    }
    if (hasInstrument) {
      return { kind: 'instrument' };
    }
    if (!employee?.nfcTagUid) {
      return { kind: 'unknown' };
    }
    if (employee.status !== 'ACTIVE') {
      return { kind: 'inactive', status: employee.status };
    }
    return {
      kind: 'employee',
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        displayName: employee.displayName,
        nfcTagUid: employee.nfcTagUid
      }
    };
  }

  async approveRecordApproval(sessionId: string, input: {
    approverEmployeeTagUid: string;
    comment?: string | null;
    clientDeviceId?: string | null;
  }) {
    const comment = input.comment?.trim() || null;
    const session = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const existing = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: recordApprovalSessionInclude
      });
      if (!existing || !existing.recordApprovalRequiredAt) {
        throw new ApiError(404, '検査記録承認対象の自主検査セッションが見つかりません');
      }
      if (existing.recordApproval) {
        throw new ApiError(409, 'この検査記録は既に承認済みです');
      }
      this.assertSessionEntryCountWritable(existing);
      const readiness = buildRecordApprovalReadiness(existing);
      if (readiness.state === 'input_incomplete') {
        throw new ApiError(409, '測定値が未登録のため承認できません');
      }
      if (readiness.state === 'registration_incomplete') {
        throw new ApiError(409, '測定者または測定機器が未登録のため承認できません');
      }
      const approver = await tx.employee.findFirst({
        where: { nfcTagUid: input.approverEmployeeTagUid.trim() },
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          nfcTagUid: true,
          status: true
        }
      });
      if (!approver?.nfcTagUid) {
        throw new ApiError(404, '承認者の社員NFCタグが登録されていません');
      }
      if (approver.status !== 'ACTIVE') {
        throw new ApiError(403, '有効な社員のみ承認できます');
      }
      const duplicateInstrumentTag = await tx.measuringInstrumentTag.findUnique({
        where: { rfidTagUid: approver.nfcTagUid },
        select: { id: true }
      });
      if (duplicateInstrumentTag) {
        throw new ApiError(409, '同一タグが社員と計測機器の両方に登録されています');
      }

      const approvedAt = new Date();
      const clientDevice = input.clientDeviceId
        ? await tx.clientDevice.findUnique({
            where: { id: input.clientDeviceId },
            select: { id: true, name: true }
          })
        : null;

      await tx.selfInspectionMeasurementValue.updateMany({
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId }
        },
        data: {
          reviewStatus: 'APPROVED',
          approvedAt,
          approvedByUserId: approver.id,
          approvedByUsername: approver.displayName,
          approvalComment: comment
        }
      });
      await this.assertAllEntriesReviewReady(tx, sessionId, existing.template);
      await tx.selfInspectionRecordApproval.create({
        data: {
          sessionId,
          approvedAt,
          approverEmployeeId: approver.id,
          approverEmployeeCodeSnapshot: approver.employeeCode,
          approverEmployeeNameSnapshot: approver.displayName,
          approverEmployeeNfcTagUidSnapshot: approver.nfcTagUid,
          comment,
          clientDeviceId: clientDevice?.id ?? null,
          clientDeviceNameSnapshot: clientDevice?.name ?? null
        }
      });
      if (!existing.completedAt) {
        const finalized = await tx.selfInspectionSession.updateMany({
          where: { id: sessionId, completedAt: null },
          data: { completedAt: approvedAt }
        });
        if (finalized.count === 0) {
          throw new ApiError(409, '自主検査セッションを完了できません');
        }
      }
      const updated = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: {
          template: { include: partMeasurementTemplateFullInclude },
          entries: { select: { entryIndex: true } },
          _count: { select: { entries: true } }
        }
      });
      if (!updated) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      return updated;
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    const [participantNamesBySessionId, pendingReviewCounts] = await Promise.all([
      loadParticipantEmployeeNamesBySessionIds([session.id]),
      loadPendingReviewCountsBySessionIds(prisma, [session.id])
    ]);
    return serializeSessionSummary(
      session,
      participantNamesBySessionId.get(session.id) ?? [],
      pendingReviewCounts.get(session.id) ?? 0
    );
  }

  async getSessionDetail(sessionId: string, options?: { entryIndex?: number }) {
    const entryIndex =
      options?.entryIndex != null && Number.isFinite(options.entryIndex)
        ? Math.floor(options.entryIndex)
        : null;

    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        entries: {
          orderBy: { entryIndex: 'asc' },
          select: {
            id: true,
            entryIndex: true,
            entrySlotKind: true,
            createdByEmployeeId: true,
            createdByEmployeeNameSnapshot: true,
            measuringInstrumentId: true,
            measuringInstrumentManagementNumberSnapshot: true,
            measuringInstrumentNameSnapshot: true,
            measuringInstrumentTagUidSnapshot: true,
            createdAt: true,
            updatedAt: true
          }
        },
        recordApproval: true,
        _count: { select: { entries: true } }
      }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }

    const focusedEntryRow =
      entryIndex != null
        ? await prisma.selfInspectionLotEntry.findUnique({
            where: {
              sessionId_entryIndex: {
                sessionId,
                entryIndex
              }
            },
            include: {
              values: {
                orderBy: { createdAt: 'asc' }
              }
            }
          })
        : null;

    const policy = sessionForEntryCountPolicy(session);
    const completedEntryCount = session._count.entries;
    const templateConfig = templateConfigFromTemplate(session.template);
    const pendingReviewCounts = await loadPendingReviewCountsBySessionIds(prisma, [session.id]);
    const pendingReviewCount = pendingReviewCounts.get(session.id) ?? 0;
    return {
      id: session.id,
      sessionBusinessKey: session.sessionBusinessKey,
      templateId: session.templateId,
      templateName: session.template.name,
      productNo: session.productNo,
      fseiban: session.fseiban,
      fhincd: session.fhincd,
      fhinmei: session.fhinmei,
      processGroup: serializeProcessGroup(session.processGroup),
      resourceCd: session.resourceCd,
      scheduleRowId: session.scheduleRowId,
      machineName: session.machineName,
      plannedQuantity: session.plannedQuantity,
      expectedEntryCount: session.expectedEntryCount,
      ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
      completedEntryCount,
      pendingReviewCount,
      participantEmployeeNames: collectParticipantEmployeeNames(session.entries),
      selfInspectionMode: serializeSelfInspectionMode(session.template.selfInspectionMode),
      selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
      selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
      status: resolveStatus({
        completedEntryCount,
        completedAt: session.completedAt,
        pendingReviewCount,
        entryIndices: session.entries.map((entry) => entry.entryIndex),
        completionPolicy: policy
      }),
      startedAt: session.startedAt?.toISOString() ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
      recordApproval: serializeRecordApproval(session.recordApproval),
      updatedAt: session.updatedAt.toISOString(),
      template: session.template,
      entries: session.entries.map((entry) => this.serializeLotEntryMeta(entry)),
      focusedEntry: focusedEntryRow ? this.serializeLotEntry(focusedEntryRow) : null
    };
  }

  private async loadSessionForMutation(
    db: Prisma.TransactionClient | typeof prisma,
    sessionId: string
  ) {
    let session = await db.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        entries: {
          select: { id: true, entryIndex: true }
        }
      }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }
    if (session.completedAt) {
      throw new ApiError(409, '完了済みの自主検査は編集できません');
    }
    if (isMisalignedLegacyFullSelfInspectionSession(session)) {
      const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
      if (planned != null && planned <= SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
        session = await db.selfInspectionSession.update({
          where: { id: sessionId },
          data: { expectedEntryCount: planned },
          include: {
            template: { include: partMeasurementTemplateFullInclude },
            entries: {
              select: { id: true, entryIndex: true }
            }
          }
        });
      }
    }
    return session;
  }

  private assertSessionEntryCountWritable(session: SessionForEntryCountPolicy): void {
    const blocked = resolveLegacyFullSelfInspectionBlockedReason(session);
    if (blocked) {
      throw new ApiError(409, blocked);
    }
  }

  private async lockSessionRow(db: Prisma.TransactionClient, sessionId: string) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SelfInspectionSession" WHERE id = ${sessionId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }
  }

  private validateMeasurementPayload(
    template: SelfInspectionTemplate,
    values: SelfInspectionMeasurementPayloadValue[],
    existingValues: ExistingMeasurementReviewValue[] = []
  ): NormalizedMeasurementValue[] {
    if (values.length !== template.items.length) {
      throw new ApiError(400, '全測定点の値を送信してください');
    }
    const expectedIds = new Set(template.items.map((item) => item.id));
    const seen = new Set<string>();
    const existingByItemId = new Map(existingValues.map((value) => [value.templateItemId, value]));
    const acknowledgedAt = new Date();
    const normalized: NormalizedMeasurementValue[] = values.map((value) => {
      if (!expectedIds.has(value.templateItemId) || seen.has(value.templateItemId)) {
        throw new ApiError(400, '測定点の指定が不正です');
      }
      seen.add(value.templateItemId);
      const item = template.items.find((row) => row.id === value.templateItemId);
      if (!item) {
        throw new ApiError(400, '測定点の指定が不正です');
      }
      const decimalValue = parseDecimal(value.value);
      if (!isBlankValue(value.value) && decimalValue == null) {
        throw new ApiError(400, '測定値は数値で入力してください');
      }
      if (decimalValue == null) {
        throw new ApiError(400, '測定値は数値で入力してください');
      }
      if (!item.allowNegative && decimalValue.lessThan(0)) {
        throw new ApiError(400, '負の値は入力できません');
      }
      if (typeof value.value === 'string') {
        const places = countDecimalPlacesString(value.value);
        if (places > item.decimalPlaces) {
          throw new ApiError(400, `小数桁数は最大${item.decimalPlaces}桁です`);
        }
      }
      assertDecimalPlacesWithinLimit(decimalValue, item.decimalPlaces);
      const existingValue = existingByItemId.get(value.templateItemId);
      const existingSameValue =
        existingValue?.value != null && existingValue.value.equals(decimalValue);
      if (isValueWithinTolerance(item, decimalValue)) {
        return {
          templateItemId: value.templateItemId,
          value: decimalValue,
          reviewStatus: 'NOT_REQUIRED',
          outOfToleranceAcknowledgedAt: null,
          approvedAt: null,
          approvedByUserId: null,
          approvedByUsername: null,
          approvalComment: null
        };
      }
      if (existingSameValue && existingValue.reviewStatus !== 'NOT_REQUIRED') {
        return {
          templateItemId: value.templateItemId,
          value: decimalValue,
          reviewStatus: existingValue.reviewStatus,
          outOfToleranceAcknowledgedAt: existingValue.outOfToleranceAcknowledgedAt,
          approvedAt: existingValue.approvedAt,
          approvedByUserId: existingValue.approvedByUserId,
          approvedByUsername: existingValue.approvedByUsername,
          approvalComment: existingValue.approvalComment
        };
      }
      if (value.outOfToleranceAcknowledged !== true) {
        throw new ApiError(400, '公差外の測定値は確認が必要です');
      }
      return {
        templateItemId: value.templateItemId,
        value: decimalValue,
        reviewStatus: 'PENDING',
        outOfToleranceAcknowledgedAt: acknowledgedAt,
        approvedAt: null,
        approvedByUserId: null,
        approvedByUsername: null,
        approvalComment: null
      };
    });
    return normalized;
  }

  private async assertAllEntriesReviewReady(
    db: Prisma.TransactionClient,
    sessionId: string,
    template: SelfInspectionTemplate
  ) {
    const entries = await db.selfInspectionLotEntry.findMany({
      where: { sessionId },
      include: { values: true }
    });
    for (const entry of entries) {
      const valuesByItem = new Map(entry.values.map((value) => [value.templateItemId, value]));
      for (const item of template.items) {
        const stored = valuesByItem.get(item.id);
        if (stored?.value == null) {
          throw new ApiError(409, '測定値が未登録のため完了できません');
        }
        if (!isValueWithinTolerance(item, stored.value) && stored.reviewStatus !== 'APPROVED') {
          throw new ApiError(409, '公差外の測定値が未承認のため完了できません');
        }
      }
    }
  }

  private async assertAllEntriesHaveRegistration(db: Prisma.TransactionClient, sessionId: string) {
    const entries = await db.selfInspectionLotEntry.findMany({
      where: { sessionId },
      select: {
        entryIndex: true,
        createdByEmployeeId: true,
        measuringInstrumentId: true
      }
    });
    for (const entry of entries) {
      if (!isSelfInspectionLotEntryRegistrationComplete(entry)) {
        throw new ApiError(
          409,
          `入力件 ${entry.entryIndex + 1} の測定者または測定機器が未登録のため完了できません`
        );
      }
    }
  }

  private assertLotEntryValuesMatchPayload(
    existing: Prisma.SelfInspectionLotEntryGetPayload<{ include: { values: true } }>,
    normalized: NormalizedMeasurementValue[]
  ) {
    if (existing.values.length !== normalized.length) {
      throw new ApiError(409, '他端末で既に登録された入力と競合しています');
    }
    const existingByItem = new Map(
      existing.values.map((value) => [value.templateItemId, value.value])
    );
    for (const value of normalized) {
      const existingValue = existingByItem.get(value.templateItemId);
      if (existingValue == null) {
        throw new ApiError(409, '他端末で既に登録された入力と競合しています');
      }
      if (!existingValue.equals(value.value)) {
        throw new ApiError(409, '他端末で既に登録された測定値と競合しています');
      }
    }
  }

  private serializeLotEntryMeta(entry: {
    id: string;
    entryIndex: number;
    entrySlotKind: import('@prisma/client').SelfInspectionEntrySlotKind;
    createdByEmployeeId: string | null;
    createdByEmployeeNameSnapshot: string | null;
    measuringInstrumentId: string | null;
    measuringInstrumentManagementNumberSnapshot: string | null;
    measuringInstrumentNameSnapshot: string | null;
    measuringInstrumentTagUidSnapshot: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const slotDto = serializeEntrySlotKind(entry.entrySlotKind);
    return {
      id: entry.id,
      entryIndex: entry.entryIndex,
      entrySlotKind: slotDto,
      entrySlotLabel: entrySlotLabelFromKind(slotDto, entry.entryIndex),
      createdByEmployeeId: entry.createdByEmployeeId,
      createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
      measuringInstrumentId: entry.measuringInstrumentId,
      measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
      measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
      measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      values: [] as Array<{
        id: string;
        templateItemId: string;
        value: string | null;
        reviewStatus: SelfInspectionMeasurementReviewStatus;
        outOfToleranceAcknowledgedAt: string | null;
        approvedAt: string | null;
        approvedByUserId: string | null;
        approvedByUsername: string | null;
        approvalComment: string | null;
      }>
    };
  }

  private serializeLotEntry(
    entry: Prisma.SelfInspectionLotEntryGetPayload<{ include: { values: true } }>
  ) {
    const slotDto = serializeEntrySlotKind(entry.entrySlotKind);
    return {
      id: entry.id,
      entryIndex: entry.entryIndex,
      entrySlotKind: slotDto,
      entrySlotLabel: entrySlotLabelFromKind(slotDto, entry.entryIndex),
      createdByEmployeeId: entry.createdByEmployeeId,
      createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
      measuringInstrumentId: entry.measuringInstrumentId,
      measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
      measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
      measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      values: entry.values.map((value) => ({
        id: value.id,
        templateItemId: value.templateItemId,
        value: value.value != null ? String(value.value) : null,
        reviewStatus: value.reviewStatus,
        outOfToleranceAcknowledgedAt: value.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
        approvedAt: value.approvedAt?.toISOString() ?? null,
        approvedByUserId: value.approvedByUserId,
        approvedByUsername: value.approvedByUsername,
        approvalComment: value.approvalComment
      }))
    };
  }

  async createEntry(sessionId: string, input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    createdByEmployeeId?: string | null;
    createdByEmployeeNameSnapshot?: string | null;
  }) {
    const entryIndex = Math.floor(input.entryIndex);
    const result = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const session = await this.loadSessionForMutation(tx, sessionId);
      this.assertSessionEntryCountWritable(session);
      const templateConfig = templateConfigFromTemplate(session.template);
      assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
      const slotKind = inferEntrySlotKindForIndex(
        templateConfig,
        session.plannedQuantity,
        entryIndex
      );

      const existingAtIndex = await tx.selfInspectionLotEntry.findUnique({
        where: {
          sessionId_entryIndex: {
            sessionId,
            entryIndex
          }
        },
        include: { values: true }
      });
      const values = this.validateMeasurementPayload(
        session.template,
        input.values,
        existingAtIndex?.values ?? []
      );
      if (existingAtIndex) {
        this.assertLotEntryValuesMatchPayload(existingAtIndex, values);
        const registration = await this.resolveRegistrationForCreateEntry(
          this.entryRegistrationFromRow(existingAtIndex),
          input
        );
        const backfillData = this.buildRegistrationBackfillData(existingAtIndex, registration);
        if (backfillData) {
          const backfilled = await tx.selfInspectionLotEntry.update({
            where: { id: existingAtIndex.id },
            data: backfillData,
            include: { values: true }
          });
          return this.serializeLotEntry(backfilled);
        }
        if (!isSelfInspectionLotEntryRegistrationComplete(existingAtIndex)) {
          throw new ApiError(400, '測定者または測定機器のNFCタグが必要です');
        }
        return this.serializeLotEntry(existingAtIndex);
      }

      const registration = await this.resolveRegistrationForCreateEntry(null, input);

      try {
        const entry = await tx.selfInspectionLotEntry.create({
          data: {
            sessionId,
            entryIndex,
            entrySlotKind: slotKind,
            createdByEmployeeId: registration.createdByEmployeeId,
            createdByEmployeeNameSnapshot: registration.createdByEmployeeNameSnapshot,
            measuringInstrumentId: registration.measuringInstrumentId,
            measuringInstrumentManagementNumberSnapshot:
              registration.measuringInstrumentManagementNumberSnapshot,
            measuringInstrumentNameSnapshot: registration.measuringInstrumentNameSnapshot,
            measuringInstrumentTagUidSnapshot: registration.measuringInstrumentTagUidSnapshot,
            values: {
              create: values
            }
          },
          include: {
            values: true
          }
        });
        return this.serializeLotEntry(entry);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const raced = await tx.selfInspectionLotEntry.findUnique({
          where: {
            sessionId_entryIndex: {
              sessionId,
              entryIndex
            }
          },
          include: { values: true }
        });
        if (!raced) {
          throw error;
        }
        this.assertLotEntryValuesMatchPayload(raced, values);
        const racedRegistration = await this.resolveRegistrationForCreateEntry(
          this.entryRegistrationFromRow(raced),
          input
        );
        const backfillData = this.buildRegistrationBackfillData(raced, racedRegistration);
        if (backfillData) {
          const backfilled = await tx.selfInspectionLotEntry.update({
            where: { id: raced.id },
            data: backfillData,
            include: { values: true }
          });
          return this.serializeLotEntry(backfilled);
        }
        if (!isSelfInspectionLotEntryRegistrationComplete(raced)) {
          throw new ApiError(400, '測定者または測定機器のNFCタグが必要です');
        }
        return this.serializeLotEntry(raced);
      }
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async updateEntry(
    sessionId: string,
    entryId: string,
    input: {
      ifUnmodifiedSince: string;
      values: SelfInspectionMeasurementPayloadValue[];
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
    }
  ) {
    const result = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const session = await this.loadSessionForMutation(tx, sessionId);
      this.assertSessionEntryCountWritable(session);
      const existingEntry = await tx.selfInspectionLotEntry.findFirst({
        where: { id: entryId, sessionId },
        include: { values: true }
      });
      if (!existingEntry) {
        throw new ApiError(404, '自主検査入力が見つかりません');
      }
      assertEntryUnmodifiedSince(input.ifUnmodifiedSince, existingEntry.updatedAt);
      const registrationPatch = await this.resolveRegistrationPatchForUpdate(existingEntry, input);
      const values = this.validateMeasurementPayload(session.template, input.values, existingEntry.values);
      const locked = await tx.selfInspectionLotEntry.updateMany({
        where: { id: entryId, sessionId, updatedAt: existingEntry.updatedAt },
        data: {
          updatedAt: new Date(),
          ...registrationPatch
        }
      });
      if (locked.count === 0) {
        throw new ApiError(409, '他端末で更新されています。再読み込みしてください。');
      }
      await tx.selfInspectionMeasurementValue.deleteMany({ where: { entryId } });
      if (values.length > 0) {
        await tx.selfInspectionMeasurementValue.createMany({
          data: values.map((value) => ({
            entryId,
            templateItemId: value.templateItemId,
            value: value.value,
            reviewStatus: value.reviewStatus,
            outOfToleranceAcknowledgedAt: value.outOfToleranceAcknowledgedAt,
            approvedAt: value.approvedAt,
            approvedByUserId: value.approvedByUserId,
            approvedByUsername: value.approvedByUsername,
            approvalComment: value.approvalComment
          }))
        });
      }
      const updated = await tx.selfInspectionLotEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { values: true }
      });
      return this.serializeLotEntry(updated);
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async completeSession(sessionId: string) {
    const sessionInclude = {
      template: { include: partMeasurementTemplateFullInclude },
      entries: { select: { entryIndex: true } },
      recordApproval: { select: { id: true } },
      _count: { select: { entries: true } }
    } as const;

    const session = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const existing = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!existing) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      if (existing.completedAt) {
        return existing;
      }
      if (existing.recordApprovalRequiredAt && !existing.recordApproval) {
        throw new ApiError(409, '検査記録承認が未完了のため完了できません');
      }
      this.assertSessionEntryCountWritable(existing);
      const templateConfig = templateConfigFromTemplate(existing.template);
      const entryRows = await tx.selfInspectionLotEntry.findMany({
        where: { sessionId },
        select: { entryIndex: true }
      });
      if (
        !isSessionCompletionReady(
          templateConfig,
          existing.plannedQuantity,
          entryRows.map((row) => row.entryIndex)
        )
      ) {
        throw new ApiError(409, '必要件数に達していないため完了できません');
      }
      await this.assertAllEntriesHaveRegistration(tx, sessionId);
      await this.assertAllEntriesReviewReady(tx, sessionId, existing.template);
      const finalized = await tx.selfInspectionSession.updateMany({
        where: { id: sessionId, completedAt: null },
        data: { completedAt: new Date() }
      });
      if (finalized.count === 0) {
        const current = await tx.selfInspectionSession.findUnique({
          where: { id: sessionId },
          include: sessionInclude
        });
        if (current?.completedAt) {
          return current;
        }
        throw new ApiError(409, '自主検査セッションを完了できません');
      }
      const completed = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!completed) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      return completed;
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    const [participantNamesBySessionId, pendingReviewCounts] = await Promise.all([
      loadParticipantEmployeeNamesBySessionIds([session.id]),
      loadPendingReviewCountsBySessionIds(prisma, [session.id])
    ]);
    return serializeSessionSummary(
      session,
      participantNamesBySessionId.get(session.id) ?? [],
      pendingReviewCounts.get(session.id) ?? 0
    );
  }

  async listPendingOutOfToleranceReviews() {
    const rows = await prisma.selfInspectionMeasurementValue.findMany({
      where: {
        reviewStatus: 'PENDING',
        entry: {
          session: {
            recordApprovalRequiredAt: null
          }
        }
      },
      include: {
        templateItem: {
          select: {
            id: true,
            sortOrder: true,
            datumSurface: true,
            measurementPoint: true,
            measurementLabel: true,
            displayMarker: true,
            unit: true,
            lowerLimit: true,
            upperLimit: true
          }
        },
        entry: {
          select: {
            id: true,
            entryIndex: true,
            entrySlotKind: true,
            updatedAt: true,
            session: {
              select: {
                id: true,
                sessionBusinessKey: true,
                templateId: true,
                productNo: true,
                processGroup: true,
                resourceCd: true,
                scheduleRowId: true,
                fseiban: true,
                fhincd: true,
                fhinmei: true,
                machineName: true,
                plannedQuantity: true,
                expectedEntryCount: true,
                startedAt: true,
                completedAt: true,
                updatedAt: true,
                template: {
                  select: {
                    name: true,
                    selfInspectionMode: true,
                    selfInspectionFixedCount: true,
                    selfInspectionSampleSize: true
                  }
                },
                entries: {
                  select: { entryIndex: true }
                },
                _count: {
                  select: { entries: true }
                }
              }
            }
          }
        }
      },
      orderBy: [{ updatedAt: 'desc' }]
    });

    const sessions = new Map<
      string,
      {
        session: (typeof rows)[number]['entry']['session'];
        values: Array<{
          id: string;
          entryId: string;
          entryIndex: number;
          entrySlotKind: ReturnType<typeof serializeEntrySlotKind>;
          entrySlotLabel: string;
          templateItemId: string;
          displayMarker: string | null;
          datumSurface: string;
          measurementPoint: string;
          measurementLabel: string;
          unit: string | null;
          value: string | null;
          lowerLimit: string | null;
          upperLimit: string | null;
          outOfToleranceAcknowledgedAt: string | null;
          updatedAt: string;
        }>;
      }
    >();

    for (const row of rows) {
      const sessionId = row.entry.session.id;
      const group = sessions.get(sessionId) ?? {
        session: row.entry.session,
        values: []
      };
      const slotDto = serializeEntrySlotKind(row.entry.entrySlotKind);
      group.values.push({
        id: row.id,
        entryId: row.entry.id,
        entryIndex: row.entry.entryIndex,
        entrySlotKind: slotDto,
        entrySlotLabel: entrySlotLabelFromKind(slotDto, row.entry.entryIndex),
        templateItemId: row.templateItemId,
        displayMarker: row.templateItem.displayMarker,
        datumSurface: row.templateItem.datumSurface,
        measurementPoint: row.templateItem.measurementPoint,
        measurementLabel: row.templateItem.measurementLabel,
        unit: row.templateItem.unit,
        value: row.value != null ? String(row.value) : null,
        lowerLimit: row.templateItem.lowerLimit != null ? String(row.templateItem.lowerLimit) : null,
        upperLimit: row.templateItem.upperLimit != null ? String(row.templateItem.upperLimit) : null,
        outOfToleranceAcknowledgedAt: row.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString()
      });
      sessions.set(sessionId, group);
    }

    return {
      sessions: [...sessions.values()]
        .map((group) => {
          const policy = sessionForEntryCountPolicy(group.session);
          const completedEntryCount = group.session._count.entries;
          const pendingReviewCount = group.values.length;
          const templateConfig = templateConfigFromTemplate(group.session.template);
          return {
            id: group.session.id,
            sessionBusinessKey: group.session.sessionBusinessKey,
            templateId: group.session.templateId,
            templateName: group.session.template.name,
            productNo: group.session.productNo,
            fseiban: group.session.fseiban,
            fhincd: group.session.fhincd,
            fhinmei: group.session.fhinmei,
            processGroup: serializeProcessGroup(group.session.processGroup),
            resourceCd: group.session.resourceCd,
            scheduleRowId: group.session.scheduleRowId,
            machineName: group.session.machineName,
            plannedQuantity: group.session.plannedQuantity,
            expectedEntryCount: group.session.expectedEntryCount,
            ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
            completedEntryCount,
            pendingReviewCount,
            selfInspectionMode: serializeSelfInspectionMode(group.session.template.selfInspectionMode),
            selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
            selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
            status: resolveStatus({
              completedEntryCount,
              completedAt: group.session.completedAt,
              pendingReviewCount,
              entryIndices: group.session.entries.map((entry) => entry.entryIndex),
              completionPolicy: policy
            }),
            startedAt: group.session.startedAt?.toISOString() ?? null,
            completedAt: group.session.completedAt?.toISOString() ?? null,
            updatedAt: group.session.updatedAt.toISOString(),
            values: group.values.sort((a, b) => {
              if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex;
              return a.displayMarker?.localeCompare(b.displayMarker ?? '') ?? 0;
            })
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    };
  }

  async approveOutOfToleranceReview(sessionId: string, input: {
    comment?: string | null;
    actorUserId: string;
    actorUsername: string;
  }) {
    const comment = input.comment?.trim() || null;
    const sessionInclude = {
      template: { include: partMeasurementTemplateFullInclude },
      entries: { select: { entryIndex: true } },
      _count: { select: { entries: true } }
    } as const;

    const session = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const existing = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!existing) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      if (existing.recordApprovalRequiredAt) {
        throw new ApiError(409, 'この自主検査はキオスクの検査記録承認で承認してください');
      }
      const pendingCount = await tx.selfInspectionMeasurementValue.count({
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId }
        }
      });
      if (pendingCount === 0) {
        throw new ApiError(409, '承認待ちの公差外測定値がありません');
      }
      this.assertSessionEntryCountWritable(existing);
      const templateConfig = templateConfigFromTemplate(existing.template);
      if (
        !isSessionCompletionReady(
          templateConfig,
          existing.plannedQuantity,
          existing.entries.map((entry) => entry.entryIndex)
        )
      ) {
        throw new ApiError(409, '必要件数に達していないため承認完了できません');
      }
      await this.assertAllEntriesHaveRegistration(tx, sessionId);

      const approvedAt = new Date();
      await tx.selfInspectionMeasurementValue.updateMany({
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId }
        },
        data: {
          reviewStatus: 'APPROVED',
          approvedAt,
          approvedByUserId: input.actorUserId,
          approvedByUsername: input.actorUsername,
          approvalComment: comment
        }
      });
      await this.assertAllEntriesReviewReady(tx, sessionId, existing.template);

      if (!existing.completedAt) {
        const finalized = await tx.selfInspectionSession.updateMany({
          where: { id: sessionId, completedAt: null },
          data: { completedAt: approvedAt }
        });
        if (finalized.count === 0) {
          throw new ApiError(409, '自主検査セッションを完了できません');
        }
      }
      const updated = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!updated) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      return updated;
    });

    resetSelfInspectionMachineBoardScheduleRowCaches();
    const [participantNamesBySessionId, pendingReviewCounts] = await Promise.all([
      loadParticipantEmployeeNamesBySessionIds([session.id]),
      loadPendingReviewCountsBySessionIds(prisma, [session.id])
    ]);
    return serializeSessionSummary(
      session,
      participantNamesBySessionId.get(session.id) ?? [],
      pendingReviewCounts.get(session.id) ?? 0
    );
  }

  async resetSession(
    sessionId: string,
    input: {
      confirmDestructiveReset: boolean;
      confirmCompletedSessionReset: boolean;
      requestId: string;
      reason?: string | null;
      clientDeviceId?: string | null;
      actorUserId?: string | null;
      actorUsername?: string | null;
      authMode: 'bearer' | 'client_key';
    }
  ) {
    const requestId = input.requestId.trim();
    if (!requestId) {
      throw new ApiError(400, 'requestId が必要です');
    }

    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }

    let clientDeviceName: string | null = null;
    if (input.clientDeviceId) {
      const device = await prisma.clientDevice.findUnique({
        where: { id: input.clientDeviceId },
        select: { name: true }
      });
      clientDeviceName = device?.name ?? null;
    }

    const result = await prisma.$transaction(async (tx) => {
      await this.lockSessionRow(tx, sessionId);
      const lockedSession = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId }
      });
      if (!lockedSession) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }

      assertSelfInspectionResetConfirmation({
        confirmDestructiveReset: input.confirmDestructiveReset,
        confirmCompletedSessionReset: input.confirmCompletedSessionReset,
        completedAt: lockedSession.completedAt
      });

      const scheduleRowId = normalizeText(lockedSession.scheduleRowId);
      if (!scheduleRowId) {
        throw new ApiError(400, '日程行IDがないためリセットできません');
      }

      await verifyProductionScheduleRowOrThrow(scheduleRowId, {
        productNo: lockedSession.productNo,
        fseiban: normalizeText(lockedSession.fseiban) || undefined,
        fhincd: lockedSession.fhincd,
        resourceCd: lockedSession.resourceCd
      });

      const supplement = await tx.productionScheduleOrderSupplement.findFirst({
        where: {
          csvDashboardRowId: scheduleRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
        },
        select: { plannedQuantity: true }
      });
      const plannedQuantity = resolveProductionSchedulePlannedQuantity(supplement?.plannedQuantity ?? null);
      if (plannedQuantity == null) {
        throw new ApiError(400, '指示数が補助データにないためリセットできません');
      }

      const activeTemplate = await tx.partMeasurementTemplate.findFirst({
        where: {
          fhincd: lockedSession.fhincd.trim(),
          processGroup: lockedSession.processGroup,
          resourceCd: lockedSession.resourceCd,
          isActive: true,
          templateScope: 'THREE_KEY'
        },
        orderBy: { version: 'desc' },
        include: partMeasurementTemplateFullInclude
      });
      if (!activeTemplate || !hasInspectionDrawingTemplateForReset(activeTemplate)) {
        throw new ApiError(400, '有効な自主検査図面テンプレートがないためリセットできません');
      }

      const templateConfig = templateConfigFromTemplateForReset(activeTemplate);
      const expectedEntryCount = resolveExpectedEntryCountForReset(templateConfig, plannedQuantity);

      const restartPayload = buildRestartPayloadFromSessionSnapshot({
        session: lockedSession,
        activeTemplateId: activeTemplate.id,
        plannedQuantity,
        expectedEntryCount
      });
      const sessionSnapshot = buildSessionResetSnapshot(lockedSession);
      const completedAtWasSet = lockedSession.completedAt != null;

      const entryCount = await tx.selfInspectionLotEntry.count({ where: { sessionId } });
      const valueCount = await tx.selfInspectionMeasurementValue.count({
        where: { entry: { sessionId } }
      });

      await tx.selfInspectionSession.delete({ where: { id: sessionId } });

      const sessionBusinessKey = buildSessionBusinessKey({
        productNo: restartPayload.productNo,
        processGroup: restartPayload.processGroup,
        resourceCd: restartPayload.resourceCd,
        scheduleRowId: restartPayload.scheduleRowId
      });

      const newSession = await tx.selfInspectionSession.create({
        data: {
          sessionBusinessKey,
          templateId: restartPayload.templateId,
          productNo: restartPayload.productNo,
          processGroup: restartPayload.processGroup,
          resourceCd: restartPayload.resourceCd,
          scheduleRowId: restartPayload.scheduleRowId,
          fseiban: restartPayload.fseiban,
          fhincd: restartPayload.fhincd,
          fhinmei: restartPayload.fhinmei,
          machineName: restartPayload.machineName,
          plannedQuantity: restartPayload.plannedQuantity,
          expectedEntryCount: restartPayload.expectedEntryCount,
          clientDeviceId: input.clientDeviceId ?? null,
          startedAt: new Date(),
          recordApprovalRequiredAt: new Date()
        }
      });

      await tx.selfInspectionSessionResetAuditLog.create({
        data: {
          actionType: SELF_INSPECTION_RESET_ACTION_TYPE,
          sessionId,
          scheduleRowId: restartPayload.scheduleRowId,
          productNo: restartPayload.productNo,
          resourceCd: restartPayload.resourceCd,
          fhincd: restartPayload.fhincd,
          templateId: lockedSession.templateId,
          nextTemplateId: restartPayload.templateId,
          actorUserId: input.actorUserId ?? null,
          actorUsername: input.actorUsername ?? null,
          authMode: input.authMode,
          clientDeviceId: input.clientDeviceId ?? null,
          clientDeviceName,
          requestId,
          reason: input.reason?.trim() || null,
          completedAtWasSet,
          entryCount,
          valueCount,
          sessionSnapshot
        }
      });

      const auditPayload = {
        actionType: SELF_INSPECTION_RESET_ACTION_TYPE,
        sessionId,
        scheduleRowId: restartPayload.scheduleRowId,
        productNo: restartPayload.productNo,
        resourceCd: restartPayload.resourceCd,
        fhincd: restartPayload.fhincd,
        templateId: lockedSession.templateId,
        nextTemplateId: restartPayload.templateId,
        actorUserId: input.actorUserId ?? null,
        actorUsername: input.actorUsername ?? null,
        authMode: input.authMode,
        clientDeviceId: input.clientDeviceId ?? null,
        clientDeviceName,
        requestId,
        reason: input.reason?.trim() || null,
        completedAtWasSet,
        entryCount,
        valueCount,
        deletedSessionId: sessionId,
        newSessionId: newSession.id
      };
      logger.info(auditPayload, 'self_inspection_session_reset');

      return {
        deletedSessionId: sessionId,
        deletedEntryCount: entryCount,
        deletedValueCount: valueCount,
        newSession: serializeResetNewSession(newSession)
      };
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async buildLeaderboardDecorations(
    rows: Array<{
      id: string;
      rowData: Prisma.JsonValue;
      plannedQuantity?: number | null;
    }>,
    scope?: { siteKey?: string },
    cache?: SelfInspectionDecorationCache
  ) {
    const activeCache =
      cache ??
      (await createSelfInspectionDecorationCache({
        siteKey: scope?.siteKey
      }));
    if (!cache) {
      await ensureSelfInspectionTemplatesForRows(activeCache, rows);
      await ensureSelfInspectionSessionsInCache(
        activeCache,
        rows
          .map((row) => row.id)
          .filter((id) => !id.startsWith(SPLIT_DISPLAY_ITEM_ID_PREFIX))
      );
    }

    return rows.map((row) => {
      if (row.id.startsWith(SPLIT_DISPLAY_ITEM_ID_PREFIX)) {
        return emptyLeaderboardSelfInspectionDecoration(row.id);
      }
      const session =
        row.id && activeCache.sessionsByScheduleRowId.has(row.id)
          ? activeCache.sessionsByScheduleRowId.get(row.id) ?? null
          : null;
      const plannedQuantity =
        resolveProductionSchedulePlannedQuantity(row.plannedQuantity) ??
        (session ? resolveProductionSchedulePlannedQuantity(session.plannedQuantity) : null);

      if (session) {
        return buildLeaderboardDecorationFromSession(row.id, session, plannedQuantity);
      }

      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      const resourceCd = normalizeText(String(rowData.FSIGENCD ?? ''));
      const fhincd = normalizeText(String(rowData.FHINCD ?? ''));
      const productNo = normalizeText(String(rowData.ProductNo ?? ''));
      const fhinmei = normalizeText(String(rowData.FHINMEI ?? ''));
      const fseiban = normalizeText(String(rowData.FSEIBAN ?? ''));
      if (!resourceCd || !fhincd || !productNo || !fhinmei || !fseiban) {
        return emptyLeaderboardSelfInspectionDecoration(row.id);
      }
      const processGroup = isProductionScheduleGrindingResourceCd(resourceCd, activeCache.policy)
        ? 'GRINDING'
        : 'CUTTING';
      const template = activeCache.templateByKey.get(templateKeyForRow(fhincd, processGroup, resourceCd));
      if (!template || !hasInspectionDrawingTemplate(template)) {
        return emptyLeaderboardSelfInspectionDecoration(row.id);
      }
      if (plannedQuantity == null) {
        return emptyLeaderboardSelfInspectionDecoration(row.id);
      }

      const expectedEntryCount = tryResolveExpectedEntryCount(template, plannedQuantity);
      if (expectedEntryCount == null) {
        return emptyLeaderboardSelfInspectionDecoration(row.id);
      }

      return {
        id: row.id,
        hasSelfInspectionDrawing: true,
        selfInspectionTemplateId: template.id,
        selfInspectionStatus: resolveStatus({
          completedEntryCount: 0,
          completedAt: null
        }),
        selfInspectionEntryPath: buildStartPath({
          templateId: template.id,
          productNo,
          processGroup: serializeProcessGroup(processGroup),
          resourceCd,
          scheduleRowId: row.id,
          fseiban,
          fhincd,
          fhinmei,
          machineName: null
        }),
        resolvedPlannedQuantity: plannedQuantity,
        resolvedRequiredEntryCount: expectedEntryCount,
        completedEntryCount: 0,
      };
    });
  }
}
