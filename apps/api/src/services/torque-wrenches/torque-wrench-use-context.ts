import { Prisma, type AssemblyTemplateBolt } from '@prisma/client';

import type {
  TorqueCondition,
  TorqueWrenchCandidate
} from './torque-wrench-eligibility.policy.js';

export const profileEligibilityInclude = {
  measuringInstrument: true,
  model: true,
  settingHistories: {
    orderBy: [{ effectiveAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1
  }
} satisfies Prisma.TorqueWrenchProfileInclude;

export type EligibilityProfile = Prisma.TorqueWrenchProfileGetPayload<{
  include: typeof profileEligibilityInclude;
}>;

export const capabilityGroupEligibilityInclude = {
  models: { select: { modelId: true } }
} satisfies Prisma.TorqueWrenchCapabilityGroupInclude;

export type EligibilityCapabilityGroup = Prisma.TorqueWrenchCapabilityGroupGetPayload<{
  include: typeof capabilityGroupEligibilityInclude;
}>;

export function conditionFromBolt(bolt: AssemblyTemplateBolt): TorqueCondition {
  return {
    templateBoltId: bolt.id,
    nominalDiameter: bolt.nominalDiameter,
    boltLengthMm: bolt.boltLengthMm,
    material: bolt.material,
    strengthClass: bolt.strengthClass,
    capabilityGroupId: bolt.capabilityGroupId,
    lowerLimit: bolt.lowerLimit,
    nominalTorque: bolt.nominalTorque,
    upperLimit: bolt.upperLimit,
    unit: bolt.unit
  };
}

export function candidateFromProfile(
  profile: EligibilityProfile,
  capabilityGroup: EligibilityCapabilityGroup
): TorqueWrenchCandidate {
  const setting = profile.settingHistories[0] ?? null;
  return {
    profileId: profile.id,
    modelId: profile.modelId,
    status: profile.measuringInstrument.status,
    calibrationExpiryDate: profile.measuringInstrument.calibrationExpiryDate,
    modelTorqueMinNm: profile.model.torqueMinNm,
    modelTorqueMaxNm: profile.model.torqueMaxNm,
    capabilityGroupId: capabilityGroup.id,
    capabilityGroupIsActive: capabilityGroup.isActive,
    capabilityGroupNominalDiameter: capabilityGroup.nominalDiameter,
    capabilityGroupBoltLengthMm: capabilityGroup.boltLengthMm,
    capabilityGroupMaterial: capabilityGroup.material,
    capabilityGroupStrengthClass: capabilityGroup.strengthClass,
    capabilityModelIds: capabilityGroup.models.map((link) => link.modelId),
    setting: setting
      ? {
          id: setting.id,
          lowerLimitNm: setting.lowerLimitNm,
          nominalTorqueNm: setting.nominalTorqueNm,
          upperLimitNm: setting.upperLimitNm
        }
      : null
  };
}
