import {
  normalizeTorqueWrenchSettingVerificationMode,
  nullableSettingHistoryId,
  type TorqueWrenchSettingVerificationMode
} from './torque-wrench-setting-mode.policy.js';
import { TorqueUnitConverter } from './torque-unit-converter.js';

export type TorqueWrenchConditionTarget = {
  lowerLimit: string;
  nominalTorque: string;
  upperLimit: string;
  unit: string;
};

type DecimalLike = { toString(): string };

export type TorqueWrenchConditionTargetSource = {
  lowerLimit: DecimalLike;
  nominalTorque: DecimalLike;
  upperLimit: DecimalLike;
  unit: string;
};

export function serializeTorqueWrenchConditionTarget(
  condition: TorqueWrenchConditionTargetSource
): TorqueWrenchConditionTarget {
  return {
    lowerLimit: condition.lowerLimit.toString(),
    nominalTorque: condition.nominalTorque.toString(),
    upperLimit: condition.upperLimit.toString(),
    unit: TorqueUnitConverter.canonicalUnit(condition.unit)
  };
}

type ModelWithPersistedSettingMode = {
  settingVerificationMode: string | null;
};

/** Normalize only the nullable legacy mode; keep Prisma Decimal/Date values intact. */
export function serializeTorqueWrenchModel<
  T extends ModelWithPersistedSettingMode
>(model: T): Omit<T, 'settingVerificationMode'> & {
  settingVerificationMode: ReturnType<typeof normalizeTorqueWrenchSettingVerificationMode>;
} {
  return {
    ...model,
    settingVerificationMode: normalizeTorqueWrenchSettingVerificationMode(
      model.settingVerificationMode
    )
  };
}

export function serializeTorqueWrenchProfile<
  T extends { model: ModelWithPersistedSettingMode }
>(profile: T): Omit<T, 'model'> & {
  model: ReturnType<typeof serializeTorqueWrenchModel<T['model']>>;
} {
  return {
    ...profile,
    model: serializeTorqueWrenchModel(profile.model)
  };
}

export function serializeTorqueWrenchConfirmation<
  T extends { settingHistoryId: string | null }
>(
  confirmation: T,
  mode: TorqueWrenchSettingVerificationMode,
  target: TorqueWrenchConditionTarget
): Omit<T, 'settingHistoryId' | 'settingVerificationMode'> & {
  settingHistoryId: string | null;
  settingVerificationMode: TorqueWrenchSettingVerificationMode;
  target: TorqueWrenchConditionTarget;
} {
  return {
    ...confirmation,
    settingHistoryId: nullableSettingHistoryId(mode, confirmation.settingHistoryId),
    settingVerificationMode: mode,
    target
  };
}
