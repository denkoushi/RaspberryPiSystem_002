import { ZERO2W_PI_CLEAR, ZERO2W_PI_UNCHANGED, type Zero2wPiSelectValue } from './zero2wPiSelectValue';

export type HaizenTargetDeviceOption = {
  id: string;
  name: string;
  shelfCodeRaw: string | null;
};

export type Zero2wPiSelectOption = {
  value: Zero2wPiSelectValue;
  label: string;
  subLabel?: string;
  disabled: boolean;
};

export function findDeviceIdOnShelf(
  devices: HaizenTargetDeviceOption[],
  shelfCodeRaw: string
): string | null {
  const match = devices.find((d) => d.shelfCodeRaw === shelfCodeRaw);
  return match?.id ?? null;
}

/**
 * Zero2W 担当棚ドロップダウン用オプション（担当なし・未変更・端末一覧）。
 */
export function buildZero2wPiSelectOptions(
  devices: HaizenTargetDeviceOption[],
  targetShelfCodeRaw: string | null
): Zero2wPiSelectOption[] {
  const options: Zero2wPiSelectOption[] = [
    {
      value: ZERO2W_PI_UNCHANGED,
      label: '— 変更しない —',
      disabled: false
    },
    {
      value: ZERO2W_PI_CLEAR,
      label: '担当なし（解除）',
      disabled: false
    }
  ];

  for (const device of devices) {
    const assignedElsewhere =
      device.shelfCodeRaw != null &&
      device.shelfCodeRaw.length > 0 &&
      targetShelfCodeRaw != null &&
      device.shelfCodeRaw !== targetShelfCodeRaw;

    options.push({
      value: device.id,
      label: device.name,
      subLabel: device.shelfCodeRaw ?? '未設定',
      disabled: assignedElsewhere
    });
  }

  return options;
}

export function piSelectionRequiresApply(
  selectedPi: Zero2wPiSelectValue,
  currentDeviceIdOnShelf: string | null
): boolean {
  if (selectedPi === ZERO2W_PI_UNCHANGED) {
    return false;
  }
  if (selectedPi === ZERO2W_PI_CLEAR) {
    return currentDeviceIdOnShelf != null;
  }
  return selectedPi !== currentDeviceIdOnShelf;
}
