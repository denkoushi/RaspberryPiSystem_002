/**
 * Aggregates per-row ProductionScheduleOrderSupplement fields onto a part (FHINCD) group.
 * Rules: earliest plannedStartDate / plannedEndDate; plannedQuantity only if all non-null values agree.
 */
export type PartSupplementAggregateState = {
  quantityDistinct: Set<number>;
  earliestStart: Date | null;
  earliestEnd: Date | null;
};

export function createPartSupplementAggregate(): PartSupplementAggregateState {
  return { quantityDistinct: new Set(), earliestStart: null, earliestEnd: null };
}

export function mergeRowIntoPartSupplementAggregate(
  agg: PartSupplementAggregateState,
  row: { plannedQuantity: number | null; plannedStartDate: Date | null; plannedEndDate: Date | null }
): void {
  if (row.plannedQuantity != null) {
    agg.quantityDistinct.add(row.plannedQuantity);
  }
  if (row.plannedStartDate) {
    const next = row.plannedStartDate;
    agg.earliestStart =
      agg.earliestStart == null || next.getTime() < agg.earliestStart.getTime() ? next : agg.earliestStart;
  }
  if (row.plannedEndDate) {
    const next = row.plannedEndDate;
    agg.earliestEnd =
      agg.earliestEnd == null || next.getTime() < agg.earliestEnd.getTime() ? next : agg.earliestEnd;
  }
}

export function finalizePartSupplementAggregate(agg: PartSupplementAggregateState): {
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
} {
  const plannedQuantity = agg.quantityDistinct.size === 1 ? [...agg.quantityDistinct][0]! : null;
  return {
    plannedQuantity,
    plannedStartDate: agg.earliestStart,
    plannedEndDate: agg.earliestEnd
  };
}
