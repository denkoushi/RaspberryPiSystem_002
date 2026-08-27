import type { Prisma } from '@prisma/client';

import {
  usesRegisteredTorqueWrenchSetting,
  type TorqueWrenchSettingVerificationMode
} from './torque-wrench-setting-mode.policy.js';

export type TorqueWrenchSettingEvidenceValues = {
  lowerLimit: Prisma.Decimal;
  nominalTorque: Prisma.Decimal;
  upperLimit: Prisma.Decimal;
  unit: string;
};

export type TorqueWrenchSettingEvidenceSnapshot = {
  lowerLimit: Prisma.Decimal | null;
  nominalTorque: Prisma.Decimal | null;
  upperLimit: Prisma.Decimal | null;
  unit: string | null;
};

/** Setting-history evidence is intentionally empty in BOLT mode. */
export function torqueWrenchSettingEvidenceSnapshot(
  mode: TorqueWrenchSettingVerificationMode,
  setting: TorqueWrenchSettingEvidenceValues | null | undefined
): TorqueWrenchSettingEvidenceSnapshot {
  if (!usesRegisteredTorqueWrenchSetting(mode) || !setting) {
    return {
      lowerLimit: null,
      nominalTorque: null,
      upperLimit: null,
      unit: null
    };
  }
  return {
    lowerLimit: setting.lowerLimit,
    nominalTorque: setting.nominalTorque,
    upperLimit: setting.upperLimit,
    unit: setting.unit
  };
}
