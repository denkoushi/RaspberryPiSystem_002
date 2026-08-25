import type {
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING,
  SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_PAGE_BODY_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_RESOURCE_ROW_HEIGHT,
  SUMMARY_PART_ROWS_PER_PAGE,
} from './layout-contracts.js';

/**
 * SummaryPage は製番グループを保持する旧契約なので、描画・ページング側では
 * まずこの関数でカード列へ戻す。グループの境界は表示上の見出しではない。
 */
export function flattenSummaryPageParts(
  page: SelfInspectionMachineBoardSummaryPage
): SelfInspectionMachineBoardPartItem[] {
  return [...page.scheduled, ...page.unscheduled].flatMap((group) => group.parts);
}

export function countSelfInspectionMachineBoardCardResources(
  card: Pick<SelfInspectionMachineBoardPartItem, 'resources' | 'resourceCds'>
): number {
  if (card.resources && card.resources.length > 0) {
    return card.resources.length;
  }
  if (card.resourceCds && card.resourceCds.length > 0) {
    return card.resourceCds.length;
  }
  return 1;
}

/** カードの実表示高さ。resourceCount は未設定でも最低 1 行を確保する。 */
export function computeSelfInspectionMachineBoardCardHeight(args: {
  resourceCount: number;
  resourceRowHeight?: number;
  scale?: number;
}): number {
  const scale = args.scale ?? 1;
  const resourceRowHeight =
    args.resourceRowHeight ?? SELF_INSPECTION_MACHINE_BOARD_RESOURCE_ROW_HEIGHT * scale;
  const resourceCount = Math.max(1, Math.floor(args.resourceCount));
  return (
    SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING * 2 * scale +
    SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT * scale +
    resourceCount * resourceRowHeight
  );
}

/** 1 ページの残り高さで資源行を読める範囲まで縮めた高さを返す。 */
export function computeSelfInspectionMachineBoardResourceRowHeight(args: {
  availableHeight: number;
  resourceCount: number;
  scale?: number;
  preferredRowHeight?: number;
  minRowHeight?: number;
}): number {
  const scale = args.scale ?? 1;
  const resourceCount = Math.max(1, Math.floor(args.resourceCount));
  const minRowHeight =
    args.minRowHeight ?? SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT * scale;
  const preferredRowHeight =
    args.preferredRowHeight ?? SELF_INSPECTION_MACHINE_BOARD_RESOURCE_ROW_HEIGHT * scale;
  const fixedHeight =
    SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING * 2 * scale +
    SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT * scale;
  const availableForRows = args.availableHeight - fixedHeight;
  if (availableForRows <= 0) {
    return minRowHeight;
  }
  return Math.max(
    minRowHeight,
    Math.min(preferredRowHeight, Math.floor(availableForRows / resourceCount))
  );
}

/** 最小可読な資源行高で 1 カードに載せられる資源数。 */
export function maxSelfInspectionMachineBoardResourcesPerCard(args?: {
  bodyHeight?: number;
  scale?: number;
  minRowHeight?: number;
}): number {
  const scale = args?.scale ?? 1;
  const bodyHeight = args?.bodyHeight ?? SELF_INSPECTION_MACHINE_BOARD_PAGE_BODY_HEIGHT * scale;
  const minRowHeight =
    args?.minRowHeight ?? SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT * scale;
  const fixedHeight =
    SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING * 2 * scale +
    SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT * scale;
  return Math.max(1, Math.floor((bodyHeight - fixedHeight) / minRowHeight));
}

export function countSummaryLayoutSlots(page: SelfInspectionMachineBoardSummaryPage): {
  sectionCount: number;
  partCount: number;
  totalSlots: number;
} {
  const allGroups = [...page.scheduled, ...page.unscheduled];
  const sectionCount = allGroups.length;
  const partCount = allGroups.reduce((sum, group) => sum + group.parts.length, 0);
  return {
    sectionCount,
    partCount,
    totalSlots: sectionCount + partCount,
  };
}

export function computeSummaryRowHeight(args: {
  bodyHeight: number;
  sectionCount: number;
  partCount: number;
  sectionHeaderHeight: number;
  groupGap: number;
  minRowHeight: number;
}): number {
  if (args.partCount <= 0) {
    return args.minRowHeight;
  }

  const fixedOverhead =
    args.sectionCount * (args.sectionHeaderHeight + args.groupGap);
  const availableForRows = args.bodyHeight - fixedOverhead;
  const computed = Math.floor(availableForRows / args.partCount);

  return Math.max(args.minRowHeight, computed);
}

export function computeDetailRowHeight(args: {
  heatAreaHeight: number;
  rowCount: number;
  minRowHeight: number;
  maxRowHeight: number;
}): number {
  if (args.rowCount <= 0) {
    return args.maxRowHeight;
  }

  const computed = Math.floor(args.heatAreaHeight / args.rowCount);
  return Math.max(args.minRowHeight, Math.min(args.maxRowHeight, computed));
}

export function assertSummaryPageFitsScreen(partCount: number): void {
  if (partCount > SUMMARY_PART_ROWS_PER_PAGE) {
    throw new Error(
      `summary page has ${partCount} part rows; max ${SUMMARY_PART_ROWS_PER_PAGE} fit on screen`
    );
  }
}
