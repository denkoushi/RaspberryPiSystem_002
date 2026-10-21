import { resolveGrindingPlanningBoardDueDate } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardOrderMetrics } from './gantt/planningBoardAutoOrder';
import type { GanttLayoutOptions } from './gantt/planningBoardGanttLayout';
import type { PlanningBoardAllocation } from './types';
import type { PlanningBoardDisplayItem } from './usePlanningBoardWriteQueue';
import type {
  GrindingPlanningBoardCategory, GrindingPlanningBoardDueScope, GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardItem, GrindingPlanningBoardOverrideItemRequest
} from '@raspi-system/shared-types';

export type CompletionOverlay = {
  isCompleted: boolean;
  completionSource: GrindingPlanningBoardItem['completionSource'];
  item: GrindingPlanningBoardItem;
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  snapshotId: string;
  saved?: boolean;
  staleSnapshotId?: string;
};

export type ResourceOrderSnapshot = { resourceCd: string; itemIds: string[] };
export type OrderPreview = { options: GanttLayoutOptions; sourceRevision: string; current: Record<string, string[]>;
  proposal: Record<string, string[]>; before: PlanningBoardOrderMetrics; after: PlanningBoardOrderMetrics };

export type ResourceOrderHistory = { id: number; scope: string; orders: ResourceOrderSnapshot[];
  restoreResource?: { itemId: string; resourceCd: string | null } };

export const EMPTY_ITEMS: GrindingPlanningBoardItem[] = [];
export const EMPTY_ORDER: string[] = [];

export const todayJst = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

export function addUtcDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function shortDate(date: string | null): string {
  return date ? date.slice(5).replace('-', '/') : '未定';
}

export function displayedDue(item: GrindingPlanningBoardItem, allocation: PlanningBoardAllocation): string | null {
  return resolveGrindingPlanningBoardDueDate(item, allocation);
}

export function defaultDueDateFor(items: readonly GrindingPlanningBoardItem[], allocation: PlanningBoardAllocation): string {
  const currentDates = items
    .map((item) => displayedDue(item, allocation))
    .filter((date): date is string => Boolean(date));
  const base = [...currentDates, todayJst()].sort().at(-1) ?? todayJst();
  return addUtcDays(base, 1);
}

export type DueMode = 'none' | 'date' | 'offsetDays' | 'restore';
export type ResourceChoice = 'unchanged' | 'restore' | string;
export type FeedbackKind = 'processing' | 'success' | 'error';

export type DuePickerState = {
  fseiban: string;
  value: string;
  scope: GrindingPlanningBoardDueScope;
  snapshot: Pick<GrindingPlanningBoardDueScopeSnapshot, 'sourceGenerationToken' | 'scopeRevision'>;
};

export type PendingDueScopeUpdate = {
  fseiban: string;
  scope: GrindingPlanningBoardDueScope;
  dueDate: string;
  baseScopeRevision: string;
  responseScopeRevision: string | null;
};

export function applyOptimisticOverride(
  item: GrindingPlanningBoardItem,
  request: GrindingPlanningBoardOverrideItemRequest
): PlanningBoardDisplayItem {
  const nextResource = request.resourceCd === undefined
    ? item.effectiveResourceCd
    : request.resourceCd ?? item.originalResourceCd;
  const resourceChanged = request.resourceCd !== undefined && nextResource !== item.effectiveResourceCd;

  let nextDue = item.effectiveDueDate;
  let dueChanged = false;
  if (request.due?.kind === 'date') {
    nextDue = request.due.date;
    dueChanged = nextDue !== item.effectiveDueDate;
  } else if (request.due?.kind === 'offsetDays') {
    const base = item.effectiveDueDate ?? item.originalDueDate ?? todayJst();
    nextDue = addUtcDays(base, request.due.days);
    dueChanged = nextDue !== item.effectiveDueDate;
  } else if (request.due?.kind === 'restore' && item.kind === 'row') {
    nextDue = item.originalDueDate;
    dueChanged = nextDue !== item.effectiveDueDate;
  }

  return {
    ...item,
    effectiveResourceCd: nextResource,
    effectiveDueDate: nextDue,
    alternateRank: resourceChanged || dueChanged ? null : item.alternateRank,
    specialDue: request.specialDue === null ? null : item.specialDue,
    ...(request.specialDue !== undefined ? { pendingSpecialDue: request.specialDue } : {})
  };
}

