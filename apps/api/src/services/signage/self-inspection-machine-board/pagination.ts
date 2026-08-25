import {
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N,
  DEFAULT_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE,
  MAX_SELF_INSPECTION_MACHINE_BOARD_DETAIL_TOP_N,
  MAX_SELF_INSPECTION_MACHINE_BOARD_PARTS_PER_PAGE,
  SELF_INSPECTION_MACHINE_BOARD_MAX_ROWS_PER_PAGE,
  SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_PAGE_BODY_HEIGHT,
} from './layout-contracts.js';
import type {
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPage,
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardResourceProgress,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  computeSelfInspectionMachineBoardCardHeight,
  countSelfInspectionMachineBoardCardResources,
  maxSelfInspectionMachineBoardResourcesPerCard,
} from './self-inspection-machine-board-layout.js';

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

function sumResources(
  resources: SelfInspectionMachineBoardResourceProgress[]
): Pick<SelfInspectionMachineBoardPartItem, 'completedEntryCount' | 'confirmedEntryCount' | 'requiredEntryCount' | 'progressLabel'> {
  const completedEntryCount = resources.reduce(
    (sum, resource) => sum + resource.confirmedEntryCount,
    0
  );
  const requiredEntryCount = resources.reduce(
    (sum, resource) => sum + resource.requiredEntryCount,
    0
  );
  return {
    completedEntryCount,
    confirmedEntryCount: completedEntryCount,
    requiredEntryCount,
    progressLabel: `${completedEntryCount}/${requiredEntryCount}`,
  };
}

/**
 * 1 枚のカードが最小行高でも縦に長すぎる場合の続きカードを作る。
 * resource 行を捨てず、カードの業務キーと表示項目は各断片へ引き継ぐ。
 */
export function splitSelfInspectionMachineBoardCard(
  part: SelfInspectionMachineBoardPartItem,
  maxResourcesPerCard: number
): SelfInspectionMachineBoardPartItem[] {
  const resources = part.resources ?? [];
  const chunkSize = Math.max(1, Math.floor(maxResourcesPerCard));
  if (resources.length <= chunkSize || resources.length === 0) {
    return [part];
  }

  const chunks: SelfInspectionMachineBoardPartItem[] = [];
  for (let offset = 0; offset < resources.length; offset += chunkSize) {
    const chunk = resources.slice(offset, offset + chunkSize);
    const progress = sumResources(chunk);
    chunks.push({
      ...part,
      ...progress,
      scheduleRowId: chunk[0]?.scheduleRowIds[0] ?? part.scheduleRowId,
      resources: chunk,
      resourceCds: chunk.map((resource) => resource.resourceCd),
      scheduleRowIds: [...new Set(chunk.flatMap((resource) => resource.scheduleRowIds))],
    });
  }
  const continuationCount = chunks.length;
  return chunks.map((chunk, index) => ({
    ...chunk,
    continuationIndex: index + 1,
    continuationCount,
    isContinuation: index > 0,
  }));
}

function cardHeightForPage(part: SelfInspectionMachineBoardPartItem, bodyHeight: number): number {
  const resourceCount = countSelfInspectionMachineBoardCardResources(part);
  const preferredHeight = computeSelfInspectionMachineBoardCardHeight({ resourceCount });
  if (preferredHeight <= bodyHeight) {
    return preferredHeight;
  }
  const minRowHeight = SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT;
  const compactHeight = computeSelfInspectionMachineBoardCardHeight({
    resourceCount,
    resourceRowHeight: minRowHeight,
  });
  // When compactHeight fits, SVG will use the reduced row height.  If it still
  // does not fit, splitSelfInspectionMachineBoardCard has bounded the count.
  return Math.min(bodyHeight, compactHeight);
}

type MachineBoardPageParts = SelfInspectionMachineBoardPartItem[];

/**
 * 資源数を考慮した 2 列 row-major のページ分割。
 * 通常は 3 行 (最大 6 枚)、左右カードのうち高い方を行高として扱う。
 */
export function paginateSelfInspectionMachineBoardParts(args: {
  orderedParts: SelfInspectionMachineBoardPartItem[];
  partsPerPage: number;
  bodyHeight?: number;
}): MachineBoardPageParts[] {
  const partsPerPage = sanitizeSelfInspectionMachineBoardPartsPerPage(args.partsPerPage);
  if (partsPerPage < 1 || args.orderedParts.length === 0) {
    return [];
  }

  const bodyHeight = args.bodyHeight ?? SELF_INSPECTION_MACHINE_BOARD_PAGE_BODY_HEIGHT;
  const maxResourcesPerCard = maxSelfInspectionMachineBoardResourcesPerCard({ bodyHeight });
  const fragments = args.orderedParts.flatMap((part) =>
    splitSelfInspectionMachineBoardCard(part, maxResourcesPerCard)
  );
  const maxRowsPerPage = Math.min(
    SELF_INSPECTION_MACHINE_BOARD_MAX_ROWS_PER_PAGE,
    Math.max(1, Math.ceil(partsPerPage / 2))
  );
  const pages: MachineBoardPageParts[] = [];
  let page: MachineBoardPageParts = [];
  let rowHeights: number[] = [];

  const flush = (): void => {
    if (page.length > 0) {
      pages.push(page);
    }
    page = [];
    rowHeights = [];
  };

  for (const fragment of fragments) {
    const height = cardHeightForPage(fragment, bodyHeight);
    const inRow = page.length % 2;
    if (inRow === 0) {
      const rowIndex = rowHeights.length;
      if (
        page.length >= partsPerPage ||
        rowIndex >= maxRowsPerPage ||
        (rowHeights.reduce((sum, value) => sum + value, 0) + height > bodyHeight && page.length > 0)
      ) {
        flush();
      }
      page.push(fragment);
      rowHeights.push(height);
      continue;
    }

    const rowIndex = rowHeights.length - 1;
    const rowHeight = Math.max(rowHeights[rowIndex] ?? 0, height);
    const usedHeight = rowHeights
      .slice(0, rowIndex)
      .reduce((sum, value) => sum + value, 0);
    if (
      page.length >= partsPerPage ||
      usedHeight + rowHeight > bodyHeight
    ) {
      // The left card remains on the current page; start the right card on a
      // fresh page so no card is clipped or discarded.
      flush();
      page.push(fragment);
      rowHeights.push(height);
      continue;
    }
    page.push(fragment);
    rowHeights[rowIndex] = rowHeight;
  }
  flush();
  return pages;
}

export function buildFlatMachineBoardPages(args: {
  machineName: string;
  updatedAt: Date;
  orderedParts: SelfInspectionMachineBoardPartItem[];
  detailPages: SelfInspectionMachineBoardDetailPage[];
  partsPerPage: number;
  scheduleRowCap?: number;
  scheduleRowHasMore?: boolean;
  bodyHeight?: number;
}): SelfInspectionMachineBoardPage[] {
  const pageParts = paginateSelfInspectionMachineBoardParts({
    orderedParts: args.orderedParts,
    partsPerPage: args.partsPerPage,
    bodyHeight: args.bodyHeight,
  });
  const summaryPageCount = pageParts.length;
  const summaryPages: SelfInspectionMachineBoardSummaryPage[] = [];

  for (let pageIndex = 0; pageIndex < summaryPageCount; pageIndex += 1) {
    const grouped = groupPartsBySeiban(pageParts[pageIndex] ?? []);
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

  // 新しい自主検査ボードは部品カードだけを表示する。detailPages は旧
  // 呼び出し元の互換引数として受け取るが、ヒートストリップ詳細を混在させない。
  void args.detailPages;
  return summaryPages.map((page, index) => ({
    ...page,
    pageIndex: index,
    pageCount: summaryPageCount,
  }));
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
