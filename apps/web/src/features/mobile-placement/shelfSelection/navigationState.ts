import type { MobilePlacementSlipResult } from '../types';

/**
 * 専用ページ遷移中も保持したい配膳ページ入力のスナップショット。
 * 専用ページへ進む前と、戻る/確定で戻すときに同じ契約を使う。
 */
export type MobilePlacementShelfRegisterRouteState = {
  transferOrder: string;
  transferFhinmei: string;
  actualOrder: string;
  actualFhinmei: string;
  slipResult: MobilePlacementSlipResult;
  shelfCode: string;
  orderBarcode: string;
};

export function isMobilePlacementShelfRegisterRouteState(
  value: unknown
): value is MobilePlacementShelfRegisterRouteState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.transferOrder === 'string' &&
    typeof v.transferFhinmei === 'string' &&
    typeof v.actualOrder === 'string' &&
    typeof v.actualFhinmei === 'string' &&
    typeof v.shelfCode === 'string' &&
    typeof v.orderBarcode === 'string' &&
    (v.slipResult === 'idle' || v.slipResult === 'ok' || v.slipResult === 'ng')
  );
}
