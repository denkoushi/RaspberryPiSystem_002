/** Replace only visible slots, keeping every hidden item at its current index. */
export function mergeVisibleResourceOrder(fullOrder: readonly string[], visibleOrder: readonly string[]): string[] {
  const visibleIds = new Set(visibleOrder);
  let index = 0;
  return fullOrder.map((id) => visibleIds.has(id) ? visibleOrder[index++]! : id);
}
