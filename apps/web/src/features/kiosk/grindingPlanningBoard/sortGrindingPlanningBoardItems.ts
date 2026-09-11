import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardView } from '@raspi-system/shared-types';


const UNKNOWN_ORDER = Number.MAX_SAFE_INTEGER;

function compareNullableIsoDate(left: string | null, right: string | null): number {
  if (left == null && right != null) return 1;
  if (left != null && right == null) return -1;
  return (left ?? '').localeCompare(right ?? '');
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'ja');
}

function compareProcessOrder(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return compareText(left, right);
}

export function resolveGrindingPlanningBoardResource(
  item: GrindingPlanningBoardItem,
  allocation: PlanningBoardAllocation
): string | null {
  return allocation === 'alternate' ? (item.effectiveResourceCd ?? item.originalResourceCd) : item.originalResourceCd;
}

export function resolveGrindingPlanningBoardDueDate(
  item: GrindingPlanningBoardItem,
  allocation: PlanningBoardAllocation
): string | null {
  return allocation === 'alternate' ? (item.effectiveDueDate ?? item.originalDueDate) : item.originalDueDate;
}

export function resolveGrindingPlanningBoardRank(
  item: GrindingPlanningBoardItem,
  allocation: PlanningBoardAllocation
): number | null {
  return allocation === 'alternate' ? item.alternateRank : item.originalRank;
}

export function compareGrindingPlanningBoardItems(
  left: GrindingPlanningBoardItem,
  right: GrindingPlanningBoardItem,
  seibanOrder: ReadonlyMap<string, number>,
  allocation: PlanningBoardAllocation,
  view: GrindingPlanningBoardView = 'seiban'
): number {
  if (view === 'resource' && allocation === 'alternate') {
    const leftRank = resolveGrindingPlanningBoardRank(left, allocation) ?? UNKNOWN_ORDER;
    const rightRank = resolveGrindingPlanningBoardRank(right, allocation) ?? UNKNOWN_ORDER;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  const leftSeibanOrder = seibanOrder.get(left.fseiban) ?? UNKNOWN_ORDER;
  const rightSeibanOrder = seibanOrder.get(right.fseiban) ?? UNKNOWN_ORDER;
  if (leftSeibanOrder !== rightSeibanOrder) return leftSeibanOrder - rightSeibanOrder;

  // Keep unregistered serials from interleaving by date or rank.
  if (leftSeibanOrder === UNKNOWN_ORDER) {
    const seibanComparison = compareText(left.fseiban, right.fseiban);
    if (seibanComparison !== 0) return seibanComparison;
  }

  const dueComparison = compareNullableIsoDate(
    resolveGrindingPlanningBoardDueDate(left, allocation),
    resolveGrindingPlanningBoardDueDate(right, allocation)
  );
  if (dueComparison !== 0) return dueComparison;

  const leftRank = resolveGrindingPlanningBoardRank(left, allocation) ?? UNKNOWN_ORDER;
  const rightRank = resolveGrindingPlanningBoardRank(right, allocation) ?? UNKNOWN_ORDER;
  if (leftRank !== rightRank) return leftRank - rightRank;

  return (
    compareText(left.fseiban, right.fseiban) ||
    compareText(left.productNo, right.productNo) ||
    compareProcessOrder(left.processOrder, right.processOrder) ||
    compareText(left.fhincd, right.fhincd) ||
    compareText(left.itemId, right.itemId)
  );
}

export function sortGrindingPlanningBoardItems(
  items: readonly GrindingPlanningBoardItem[],
  seibanOrder: readonly string[],
  view: GrindingPlanningBoardView,
  allocation: PlanningBoardAllocation
): GrindingPlanningBoardItem[] {
  const orderBySeiban = new Map(seibanOrder.map((fseiban, index) => [fseiban, index] as const));
  return items
    .slice()
    .sort((left, right) => {
      return compareGrindingPlanningBoardItems(left, right, orderBySeiban, allocation, view);
    })
}
