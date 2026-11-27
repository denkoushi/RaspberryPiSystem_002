type ArrivalItem = {
  arrived?: boolean;
  waitingForPair?: boolean;
  isCompleted: boolean;
  specialDue?: unknown;
  pendingSpecialDue?: unknown;
};

export function isVisibleByArrival(item: ArrivalItem, enabled: boolean): boolean {
  const specialDue = item.pendingSpecialDue !== undefined ? item.pendingSpecialDue : item.specialDue;
  return !enabled || item.isCompleted || Boolean(specialDue) || (item.arrived !== false && !item.waitingForPair);
}
