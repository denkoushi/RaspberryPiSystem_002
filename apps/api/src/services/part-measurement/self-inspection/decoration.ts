import type { PartMeasurementProcessGroup, Prisma, SelfInspectionMode } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleGrindingResourceCd
} from '../../production-schedule/policies/resource-category-policy.service.js';
import { SPLIT_DISPLAY_ITEM_ID_PREFIX } from '../../production-schedule/order-split/leaderboard-display-item-id.js';
import { resolveProductionSchedulePlannedQuantity } from '../../production-schedule/self-inspection-schedule-eligibility.js';
import { partMeasurementTemplateFullInclude } from '../part-measurement-template-include.js';
import { tryResolveExpectedEntryCount } from '../self-inspection-config.js';
import {
  hasInspectionDrawingTemplate,
  normalizeText,
  resolveRequiredEntryCountForCompletion,
  resolveStatus,
  serializeProcessGroup,
  templateConfigFromTemplate,
  type SelfInspectionStatusDto,
  type SelfInspectionTemplate
} from './shared.js';
import { loadPendingReviewCountsBySessionIds } from './serialization.js';
import { confirmedEntriesCountSelect, isConfirmed } from './entry-persistence-status.js';


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
  resourceCd: string;
  plannedQuantity: number;
  expectedEntryCount: number;
  completedAt: Date | null;
  updatedAt: Date;
  pendingReviewCount?: number;
  entries: Array<{ entryIndex: number; persistenceStatus?: string }>;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount: number | null;
    selfInspectionSampleSize: number | null;
    siblingGroupId: string | null;
  };
  _count: { entries: number };
};

export type SelfInspectionDecorationCache = {
  policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>;
  templateByKey: Map<string, SelfInspectionTemplate>;
  resourceCdsBySiblingGroupId: Map<string, string[]>;
  invalidatedScheduleRowIds: Set<string>;
  /** 値 null = 問い合わせ済み・セッションなし（negative cache） */
  sessionsByScheduleRowId: Map<string, SelfInspectionSessionForDecoration | null>;
};

function templateKeyForRow(
  fhincd: string,
  processGroup: PartMeasurementProcessGroup,
  resourceCd: string,
  fkojun: string | null
): string {
  return `${fhincd}::${processGroup}::${normalizeText(fkojun)}::${resourceCd}`;
}

async function loadActiveResourceCdsBySiblingGroupIds(groupIds: string[]) {
  const groupIdsUnique = [...new Set(groupIds.filter(Boolean))];
  const result = new Map<string, string[]>();
  if (groupIdsUnique.length === 0) return result;
  const rows = await prisma.partMeasurementTemplate.findMany({
    where: { siblingGroupId: { in: groupIdsUnique }, isActive: true, templateScope: 'THREE_KEY' },
    orderBy: [{ siblingGroupId: 'asc' }, { resourceCd: 'asc' }],
    select: { siblingGroupId: true, resourceCd: true }
  });
  for (const row of rows) {
    if (!row.siblingGroupId) continue;
    const codes = result.get(row.siblingGroupId) ?? [];
    codes.push(row.resourceCd);
    result.set(row.siblingGroupId, codes);
  }
  return result;
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
  const resourceCdsBySiblingGroupId = new Map<string, string[]>();
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
        templateKeyForRow(template.fhincd, template.processGroup, template.resourceCd, template.fkojun),
        template
      );
    }
    const groupResources = await loadActiveResourceCdsBySiblingGroupIds(
      templates.map((template) => template.siblingGroupId ?? '')
    );
    for (const [groupId, resourceCds] of groupResources) resourceCdsBySiblingGroupId.set(groupId, resourceCds);
  }
  return {
    policy,
    templateByKey,
    resourceCdsBySiblingGroupId,
    invalidatedScheduleRowIds: new Set(),
    sessionsByScheduleRowId: new Map()
  };
}

export async function ensureSelfInspectionTemplatesForRows(
  cache: SelfInspectionDecorationCache,
  rows: Array<{ rowData: Prisma.JsonValue }>
): Promise<void> {
  const missingKeys = new Map<string, { fhincd: string; processGroup: PartMeasurementProcessGroup; resourceCd: string; fkojun: string }>();
  for (const row of rows) {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = normalizeText(String(rowData.FSIGENCD ?? ''));
    const fhincd = normalizeText(String(rowData.FHINCD ?? ''));
    const fkojun = normalizeText(String(rowData.FKOJUN ?? ''));
    if (!resourceCd || !fhincd) continue;
    const processGroup = isProductionScheduleGrindingResourceCd(resourceCd, cache.policy) ? 'GRINDING' : 'CUTTING';
    const key = templateKeyForRow(fhincd, processGroup, resourceCd, fkojun);
    const legacyKey = templateKeyForRow(fhincd, processGroup, resourceCd, '');
    if (!cache.templateByKey.has(key) && !(fkojun && cache.templateByKey.has(legacyKey)) && !missingKeys.has(key)) {
      missingKeys.set(key, { fhincd, processGroup, resourceCd, fkojun });
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
        resourceCd: key.resourceCd,
        OR: key.fkojun
          ? [{ fkojun: key.fkojun }, { fkojun: '' }, { fkojun: null }]
          : [{ fkojun: '' }, { fkojun: null }]
      }))
    },
    include: partMeasurementTemplateFullInclude
  });
  for (const template of templates) {
    if (!hasInspectionDrawingTemplate(template)) {
      continue;
    }
    cache.templateByKey.set(
      templateKeyForRow(template.fhincd, template.processGroup, template.resourceCd, template.fkojun),
      template
    );
  }
  const groupResources = await loadActiveResourceCdsBySiblingGroupIds(
    templates.map((template) => template.siblingGroupId ?? '')
  );
  for (const [groupId, resourceCds] of groupResources) cache.resourceCdsBySiblingGroupId.set(groupId, resourceCds);
}

export async function ensureSelfInspectionSessionsInCache(
  cache: SelfInspectionDecorationCache,
  scheduleRowIds: string[]
): Promise<void> {
  const missingIds = scheduleRowIds.filter((id) => id.length > 0 && !cache.sessionsByScheduleRowId.has(id));
  if (missingIds.length === 0) {
    return;
  }
  const [sessions, invalidations] = await Promise.all([
    prisma.selfInspectionSession.findMany({
      where: { scheduleRowId: { in: missingIds }, invalidatedAt: null },
      include: {
        template: {
          select: {
            selfInspectionMode: true,
            selfInspectionFixedCount: true,
            selfInspectionSampleSize: true,
            siblingGroupId: true,
          },
        },
        entries: {
          select: {
            entryIndex: true,
            persistenceStatus: true,
          },
        },
        _count: { select: confirmedEntriesCountSelect },
      },
    }),
    prisma.selfInspectionItemInvalidation.findMany({
      where: { scheduleRowId: { in: missingIds } },
      select: { scheduleRowId: true }
    })
  ]);
  for (const invalidation of invalidations) {
    cache.invalidatedScheduleRowIds.add(invalidation.scheduleRowId);
    cache.sessionsByScheduleRowId.set(invalidation.scheduleRowId, null);
  }
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
    if (cache.invalidatedScheduleRowIds.has(session.scheduleRowId)) {
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

type LeaderboardSelfInspectionDecoration = {
  id: string;
  hasSelfInspectionDrawing: boolean;
  selfInspectionTemplateId: string | null;
  selfInspectionStatus: SelfInspectionStatusDto | null;
  selfInspectionEntryPath: string | null;
  selfInspectionResourceCds?: string[];
  selfInspectionResourceCd?: string | null;
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
    selfInspectionResourceCds: [session.resourceCd],
    selfInspectionResourceCd: session.resourceCd,
    selfInspectionStatus: resolveStatus({
      completedEntryCount: session._count.entries,
      hasAnyLotEntry: session.entries.length > 0,
      completedAt: session.completedAt,
      pendingReviewCount: session.pendingReviewCount ?? 0,
      entryIndices: session.entries
        .filter((entry) =>
          entry.persistenceStatus == null ? true : isConfirmed(entry.persistenceStatus)
        )
        .map((entry) => entry.entryIndex),
      completionPolicy: policy
    }),
    selfInspectionEntryPath: `/kiosk/part-measurement/self-inspection/sessions/${session.id}`,
    resolvedPlannedQuantity: planned,
    resolvedRequiredEntryCount: resolveRequiredEntryCountForCompletion(policy),
    completedEntryCount: session._count.entries,
    pendingReviewCount: session.pendingReviewCount ?? 0,
  };
}

export async function buildLeaderboardDecorations(
  rows: Array<{
    id: string;
    rowData: Prisma.JsonValue;
    plannedQuantity?: number | null;
    machineName?: string | null;
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
    if (activeCache.invalidatedScheduleRowIds.has(row.id)) {
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
    const fkojun = normalizeText(String(rowData.FKOJUN ?? ''));
    const fseiban = normalizeText(String(rowData.FSEIBAN ?? ''));
    if (!resourceCd || !fhincd || !productNo || !fhinmei || !fseiban) {
      return emptyLeaderboardSelfInspectionDecoration(row.id);
    }
    const processGroup = isProductionScheduleGrindingResourceCd(resourceCd, activeCache.policy)
      ? 'GRINDING'
      : 'CUTTING';
    const template =
      activeCache.templateByKey.get(templateKeyForRow(fhincd, processGroup, resourceCd, fkojun)) ??
      (fkojun
        ? activeCache.templateByKey.get(templateKeyForRow(fhincd, processGroup, resourceCd, ''))
        : undefined);
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
      selfInspectionResourceCds: template.siblingGroupId
        ? activeCache.resourceCdsBySiblingGroupId.get(template.siblingGroupId) ?? [template.resourceCd]
        : [template.resourceCd],
      selfInspectionResourceCd: null,
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
        machineName: row.machineName ?? null
      }),
      resolvedPlannedQuantity: plannedQuantity,
      resolvedRequiredEntryCount: expectedEntryCount,
      completedEntryCount: 0,
    };
  });
}
