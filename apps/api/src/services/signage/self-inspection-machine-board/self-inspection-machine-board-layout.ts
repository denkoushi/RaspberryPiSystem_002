import type { SelfInspectionMachineBoardSummaryPage } from '../../part-measurement/self-inspection-machine-board.types.js';
import { SUMMARY_PART_ROWS_PER_PAGE } from './layout-contracts.js';

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
