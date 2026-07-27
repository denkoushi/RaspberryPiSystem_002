import {
  kioskFlowButtonClass,
  type KioskFlowButtonClassOptions,
  type KioskFlowButtonSize,
  type KioskFlowButtonTone
} from '../kiosk/kioskFlowButtonTheme';

export type SelfInspectionKioskButtonSize = KioskFlowButtonSize;
export type SelfInspectionKioskButtonTone = KioskFlowButtonTone;
export type SelfInspectionKioskButtonClassOptions = KioskFlowButtonClassOptions;

/** 既存export互換。正本はキオスク共通フローボタンテーマ。 */
export function selfInspectionKioskButtonClass(
  options: SelfInspectionKioskButtonClassOptions = {}
): string {
  return kioskFlowButtonClass(options);
}
