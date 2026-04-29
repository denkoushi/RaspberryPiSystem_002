import { ORDER_NUMBERS } from '../productionSchedule/resourceColors';

/**
 * 生産スケジュール画面と同じ規則: 現在値 or 未使用の順位番号のみ選択可。
 */
export function availableProcessingOrderOptions(
  resourceCd: string,
  currentOrder: number | null,
  usageNumbers: readonly number[] | undefined
): number[] {
  if (resourceCd.trim().length === 0) return [];
  const usage = usageNumbers ?? [];
  return ORDER_NUMBERS.filter((num) => num === currentOrder || !usage.includes(num));
}
