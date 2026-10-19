import type { TorqueWrenchSettingVerificationMode } from '@raspi-system/shared-types';
export type { TorqueWrenchSettingVerificationMode } from '@raspi-system/shared-types';

/**
 * The setting-verification mode is stored as a nullable string during the
 * expand phase.  A missing (or otherwise unknown) value is the historical
 * registered-setting behaviour; only the explicit BOLT value opts out of
 * setting-history checks.
 */
export const TORQUE_WRENCH_SETTING_VERIFICATION_MODES = [
  'REGISTERED_SETTING',
  'BOLT_CONDITION_ONLY'
] as const satisfies readonly TorqueWrenchSettingVerificationMode[];

export function normalizeTorqueWrenchSettingVerificationMode(
  value: string | null | undefined
): TorqueWrenchSettingVerificationMode {
  return value === 'BOLT_CONDITION_ONLY' ? 'BOLT_CONDITION_ONLY' : 'REGISTERED_SETTING';
}

export function usesRegisteredTorqueWrenchSetting(
  value: string | null | undefined
): boolean {
  return normalizeTorqueWrenchSettingVerificationMode(value) === 'REGISTERED_SETTING';
}

export function nullableSettingHistoryId(
  mode: TorqueWrenchSettingVerificationMode,
  settingHistoryId: string | null | undefined
): string | null {
  return mode === 'BOLT_CONDITION_ONLY' ? null : settingHistoryId ?? null;
}
