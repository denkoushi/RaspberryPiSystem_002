import { isZero2wDeviceId, type Zero2wPiSelectValue } from './zero2wPiSelectValue';

export type PendingZero2wPreset = { kind: 'assign'; clientDeviceId: string; shelfCodeRaw: string };

/**
 * 部品置き場割当後にレイアウト保存完了時へ送る preset キューへ追加。
 */
export function appendPendingFromPiSelect(
  queue: PendingZero2wPreset[],
  shelfCodeRaw: string,
  selectedPi: Zero2wPiSelectValue
): PendingZero2wPreset[] {
  if (!isZero2wDeviceId(selectedPi)) {
    return queue;
  }
  return [
    ...queue.filter(
      (p) => !(p.clientDeviceId === selectedPi && p.shelfCodeRaw === shelfCodeRaw)
    ),
    { kind: 'assign', clientDeviceId: selectedPi, shelfCodeRaw }
  ];
}
