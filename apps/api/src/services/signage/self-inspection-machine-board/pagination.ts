import {
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N,
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE,
  MAX_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N,
  MAX_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE,
} from './layout-contracts.js';
import type {
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPage,
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';

export function sanitizeSelfInspectionMachineBoardPartsPerPage(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE;
  }
  const n = Math.floor(value);
  if (n < 1) {
    return 1;
  }
  if (n > MAX_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE) {
    return MAX_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE;
  }
  return n;
}

export function sanitizeSelfInspectionMachineBoardDetailTopN(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N;
  }
  const n = Math.floor(value);
  if (n < 0) {
    return 0;
  }
  if (n > MAX_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N) {
    return MAX_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N;
  }
  return n;
}

export function summaryPartsPageCount(partCount: number, partsPerPage: number): number {
  if (partsPerPage < 1 || partCount <= 0) {
    return 0;
  }
  return Math.ceil(partCount / partsPerPage);
}

export function sliceFlatPartsPage<T>(parts: T[], pageIndex: number, partsPerPage: number): T[] {
  if (partsPerPage < 1) {
    return [];
  }
  const start = pageIndex * partsPerPage;
  return parts.slice(start, start + partsPerPage);
}

export function groupPartsBySeiban(parts: SelfInspectionMachineBoardPartItem[]): {
  scheduled: SelfInspectionMachineBoardSummaryPage['scheduled'];
  unscheduled: SelfInspectionMachineBoardSummaryPage['unscheduled'];
} {
  const scheduledMap = new Map<string, SelfInspectionMachineBoardPartItem[]>();
  const unscheduledMap = new Map<string, SelfInspectionMachineBoardPartItem[]>();

  for (const part of parts) {
    const target = part.isScheduled ? scheduledMap : unscheduledMap;
    const list = target.get(part.fseiban);
    if (list) {
      list.push(part);
    } else {
      target.set(part.fseiban, [part]);
    }
  }

  const toGroups = (map: Map<string, SelfInspectionMachineBoardPartItem[]>) =>
    [...map.entries()]
      .map(([fseiban, groupParts]) => ({
        fseiban,
        dueDate: groupParts[0]?.dueDate ?? null,
        parts: groupParts,
      }))
      .sort((a, b) => {
        const aTime = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        const bTime = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.fseiban.localeCompare(b.fseiban);
      });

  return {
    scheduled: toGroups(scheduledMap),
    unscheduled: toGroups(unscheduledMap),
  };
}

export function buildFlatMachineBoardPages(args: {
  machineName: string;
  updatedAt: Date;
  orderedParts: SelfInspectionMachineBoardPartItem[];
  detailPages: SelfInspectionMachineBoardDetailPage[];
  partsPerPage: number;
  scheduleRowCap?: number;
  scheduleRowHasMore?: boolean;
}): SelfInspectionMachineBoardPage[] {
  const summaryPageCount = summaryPartsPageCount(args.orderedParts.length, args.partsPerPage);
  const summaryPages: SelfInspectionMachineBoardSummaryPage[] = [];

  for (let pageIndex = 0; pageIndex < summaryPageCount; pageIndex += 1) {
    const pageParts = sliceFlatPartsPage(args.orderedParts, pageIndex, args.partsPerPage);
    const grouped = groupPartsBySeiban(pageParts);
    summaryPages.push({
      kind: 'summary',
      machineName: args.machineName,
      updatedAt: args.updatedAt,
      scheduled: grouped.scheduled,
      unscheduled: grouped.unscheduled,
      pageIndex,
      pageCount: summaryPageCount + args.detailPages.length,
      scheduleRowCap: args.scheduleRowCap,
      scheduleRowHasMore: args.scheduleRowHasMore,
    });
  }

  const detailWithIndex = args.detailPages.map((page, index) => ({
    ...page,
    pageIndex: summaryPageCount + index,
    pageCount: summaryPageCount + args.detailPages.length,
    scheduleRowCap: args.scheduleRowCap,
    scheduleRowHasMore: args.scheduleRowHasMore,
  }));

  return [...summaryPages, ...detailWithIndex];
}

export function resolveMachineBoardPage(
  pages: SelfInspectionMachineBoardPage[],
  pageIndex: number
): SelfInspectionMachineBoardPage | null {
  if (pages.length === 0) {
    return null;
  }
  const normalized = ((pageIndex % pages.length) + pages.length) % pages.length;
  return pages[normalized] ?? null;
}
