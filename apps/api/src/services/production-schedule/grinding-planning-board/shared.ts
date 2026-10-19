import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardDueRequest, GrindingPlanningBoardItem, GrindingPlanningBoardLoad, GrindingPlanningBoardResponse, GrindingPlanningBoardSpecialDueKind } from '@raspi-system/shared-types';
import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { getResourceCategoryPolicy, isProductionScheduleCuttingResourceCd, isProductionScheduleGrindingResourceCd } from '../policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from '../row-resolver/constants.js';
import { buildGrindingPlanningBoardLogicalKey as buildProjectionLogicalKey, buildGrindingPlanningBoardRowItemId, type GrindingPlanningBoardProjectionRanks, type GrindingPlanningBoardProgressRow, type GrindingPlanningBoardProjectionRow, type GrindingPlanningBoardProjectionRowDetail } from '../grinding-planning-board-projection.js';


export const DEFAULT_PAGE_SIZE = 160;
export const MAX_PAGE_SIZE = 640;
export const MAX_ALTERNATE_RANK = 2_147_483_647;
export const SPLIT_PREFIX = 'split:';
export type ReusablePlanningPayload = {
  siteKey: string;
  generationToken: string;
  orderedRowIds: readonly string[];
  payload: PlanningSnapshotPayload;
  expiresAtMs: number;
};

export type DbClient = Prisma.TransactionClient | typeof prisma;
type RowData = Record<string, unknown>;
export type WinnerRow = GrindingPlanningBoardProjectionRow;
export type RowDetail = GrindingPlanningBoardProjectionRowDetail;
export type RankRow = {
  csvDashboardRowId: string;
  resourceCd: string;
  orderNumber: number;
  updatedAt: Date;
  siteKey: string;
  location: string;
};
export type SplitRankRow = {
  splitId: string;
  resourceCd: string;
  orderNumber: number;
  updatedAt: Date;
  siteKey: string;
  location: string;
};
export type PlanningState = {
  id: string;
  version: number;
  updatedAt?: Date | null;
  seibanOrder: Prisma.JsonValue;
};
export type PlanningSnapshotGenerationDetails = {
  generationToken: string;
  leaderboardGenerationToken: string;
  boardVersion: number;
  boardUpdatedAt: string;
};
export type CurrentProjection = {
  state: PlanningState;
  byItemId: Map<string, GrindingPlanningBoardItem>;
  overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>;
  rows: WinnerRow[];
  details: Map<string, RowDetail>;
  ranks: GrindingPlanningBoardProjectionRanks;
  progressRows: GrindingPlanningBoardProgressRow[];
  splitEnabled: boolean;
  policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>;
  sourceRowIds: Map<string, string>;
  masterResourceCds: Set<string>;
  parentEffectiveDueBySourceRow: Map<string, string | null>;
  splitOriginalDueByItemId: Map<string, string | null>;
};

export function asRowData(value: unknown): RowData {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as RowData : {};
}

export function valueAsString(data: RowData, key: string): string {
  const value = data[key];
  return value == null ? '' : String(value);
}

export function buildGrindingPlanningBoardLogicalKey(rowData: RowData): string {
  return buildProjectionLogicalKey(rowData);
}

export function buildGrindingPlanningBoardItemId(rowData: RowData): string {
  return buildGrindingPlanningBoardRowItemId(rowData);
}

export function decodeRowItemId(itemId: string): string | null {
  if (!itemId.startsWith('row:')) return null;
  try {
    const parsed = JSON.parse(Buffer.from(itemId.slice(4), 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === 'string') || !(
      parsed.length === PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.length && parsed[0] !== '********'
      || parsed.length === PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.length + 1 && parsed[0] === '********'
    )) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export function ymd(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function dateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromYmd(value);
  return !Number.isNaN(date.getTime()) && ymd(date) === value;
}

function todayJstYmd(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function resolvePlanningBoardDueRequest(params: {
  request: GrindingPlanningBoardDueRequest;
  currentEffectiveDueDate: string | null;
  originalDueDate: string | null;
}): Date | null | undefined {
  if (params.request.kind === 'restore') return null;
  if (params.request.kind === 'date') {
    if (!isYmd(params.request.date)) throw new ApiError(400, '納期はYYYY-MM-DDで指定してください', undefined, 'INVALID_DUE_DATE');
    if (params.request.date === params.currentEffectiveDueDate) return undefined;
    if ((params.currentEffectiveDueDate == null || params.request.date < params.currentEffectiveDueDate)
      && params.request.date < todayJstYmd()) {
      throw new ApiError(400, '過去の日付は指定できません', undefined, 'PAST_DUE_DATE');
    }
    return dateFromYmd(params.request.date);
  }
  if (!Number.isSafeInteger(params.request.days) || params.request.days <= 0) {
    throw new ApiError(400, '延期日数は1以上の整数で指定してください', undefined, 'INVALID_DUE_OFFSET');
  }
  const base = dateFromYmd(params.currentEffectiveDueDate ?? params.originalDueDate ?? todayJstYmd());
  base.setUTCDate(base.getUTCDate() + params.request.days);
  return base;
}

export function normalizeUniqueFseibans(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function uniqueFseibans(values: readonly string[]): string[] {
  return normalizeUniqueFseibans(values).slice(0, KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
}

export function isCategoryResource(resourceCd: string | null, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): boolean {
  if (!resourceCd) return false;
  return (category !== 'cutting' && isProductionScheduleGrindingResourceCd(resourceCd, policy)) ||
    (category !== 'grinding' && isProductionScheduleCuttingResourceCd(resourceCd, policy));
}

/** `decodeRowItemId` guarantees a JSON array of strings. */
export function logicalKeyFseiban(logicalKey: string): string {
  return (JSON.parse(logicalKey) as string[])[0];
}

export function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (text.length === 0) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00.000Z`
    : /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text)
      ? text
      : `${text}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type PlanningSource = {
  baseWhere: Prisma.Sql;
  generationToken: string;
  rows: WinnerRow[];
  details: Map<string, RowDetail>;
  progressRows: GrindingPlanningBoardProgressRow[];
};

export type PlanningSnapshotPayload = {
  items: GrindingPlanningBoardItem[];
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
  seibanProgress: Record<string, { completed: number; total: number }>;
  machineNames?: GrindingPlanningBoardResponse['machineNames'];
  resources: string[];
  resourceCategories?: GrindingPlanningBoardResponse['resourceCategories'];
};

export function progressMapToRecord(progress: ReadonlyMap<string, { completed: number; total: number }>): Record<string, { completed: number; total: number }> { return Object.fromEntries(progress.entries()); }

export type PersistedSpecialDue = {
  specialDueKind: string | null;
  specialDueExpiresAt: Date | null;
};

export type OverrideRequest = { orderPinned?: boolean; itemId: string; itemRevision: string; overrideVersion?: number; resourceCd?: string | null; due?: GrindingPlanningBoardDueRequest; specialDue?: GrindingPlanningBoardSpecialDueKind | null; alternateRank?: number | null };

export type AppliedOverrides = {
  state: PlanningState;
  current: CurrentProjection;
  overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>;
};
