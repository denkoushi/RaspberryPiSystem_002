import { Prisma, type TorqueTrainingProgramVersion } from '@prisma/client';
import type { TorqueWrenchRejectionReason } from '@raspi-system/shared-types';

import {
  evaluateTorqueWrenchSetupReadiness,
  type TorqueCondition,
  type TorqueWrenchSetupReadinessDecision
} from '../torque-wrenches/torque-wrench-eligibility.policy.js';
import {
  candidateFromProfile,
  capabilityGroupEligibilityInclude,
  profileEligibilityInclude,
  type EligibilityCapabilityGroup,
  type EligibilityProfile
} from '../torque-wrenches/torque-wrench-use-context.js';

/** All data needed to evaluate setup readiness is loaded at this boundary. */
export const trainingSetupVersionInclude = {
  program: true,
  capabilityGroup: { include: capabilityGroupEligibilityInclude },
  wrenches: {
    orderBy: { createdAt: 'asc' as const },
    include: { torqueWrenchProfile: { include: profileEligibilityInclude } }
  }
} as const satisfies Prisma.TorqueTrainingProgramVersionInclude;

export type TrainingSetupVersion = Prisma.TorqueTrainingProgramVersionGetPayload<{
  include: typeof trainingSetupVersionInclude;
}>;

export type TorqueTrainingSetupState = 'READY' | 'UNASSIGNED' | 'UNAVAILABLE';
export type TorqueTrainingSetupReason = 'NO_ASSIGNED_WRENCH' | TorqueWrenchRejectionReason;

export type TorqueTrainingSetupDecision = {
  setupState: TorqueTrainingSetupState;
  setupStateReason: TorqueTrainingSetupReason | null;
  readyProfileIds: string[];
  profileReasons: Array<{ profileId: string; reason: TorqueWrenchRejectionReason | null }>;
};

export type TrainingVersionCondition = Pick<
  TorqueTrainingProgramVersion,
  | 'id'
  | 'nominalDiameter'
  | 'boltLengthMm'
  | 'material'
  | 'strengthClass'
  | 'capabilityGroupId'
  | 'lowerLimit'
  | 'nominalTorque'
  | 'upperLimit'
  | 'unit'
>;

export function conditionFromTrainingVersion(version: TrainingVersionCondition): TorqueCondition {
  return {
    templateBoltId: version.id,
    nominalDiameter: version.nominalDiameter,
    boltLengthMm: version.boltLengthMm,
    material: version.material,
    strengthClass: version.strengthClass,
    capabilityGroupId: version.capabilityGroupId,
    lowerLimit: version.lowerLimit,
    nominalTorque: version.nominalTorque,
    upperLimit: version.upperLimit,
    unit: version.unit
  };
}

export function evaluateTrainingProfileSetup(
  condition: TorqueCondition,
  profile: EligibilityProfile,
  capabilityGroup: EligibilityCapabilityGroup,
  now = new Date()
): TorqueWrenchSetupReadinessDecision {
  return evaluateTorqueWrenchSetupReadiness(condition, candidateFromProfile(profile, capabilityGroup), now);
}

/**
 * Aggregate assigned profile readiness for the program-list and start gates.
 * Empty assignments are represented separately so the kiosk can explain that
 * the catalog exists but no physical wrench has been assigned yet.
 */
export function evaluateTrainingVersionSetup(
  version: Pick<TrainingSetupVersion, 'id' | 'nominalDiameter' | 'boltLengthMm' | 'material' | 'strengthClass' | 'capabilityGroupId' | 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit' | 'capabilityGroup' | 'wrenches'>,
  now = new Date()
): TorqueTrainingSetupDecision {
  if (version.wrenches.length === 0) {
    return {
      setupState: 'UNASSIGNED',
      setupStateReason: 'NO_ASSIGNED_WRENCH',
      readyProfileIds: [],
      profileReasons: []
    };
  }

  const condition = conditionFromTrainingVersion(version);
  const profileDecisions = version.wrenches.map((wrench) => {
    const decision = evaluateTrainingProfileSetup(
      condition,
      wrench.torqueWrenchProfile,
      version.capabilityGroup,
      now
    );
    return {
      profileId: wrench.torqueWrenchProfile.id,
      reason: decision.ready ? null : decision.reason
    };
  });
  const readyProfileIds = profileDecisions
    .filter((entry) => entry.reason === null)
    .map((entry) => entry.profileId);
  if (readyProfileIds.length > 0) {
    return {
      setupState: 'READY',
      setupStateReason: null,
      readyProfileIds,
      profileReasons: profileDecisions
    };
  }

  return {
    setupState: 'UNAVAILABLE',
    setupStateReason: profileDecisions[0]?.reason ?? 'WRONG_CAPABILITY_GROUP',
    readyProfileIds,
    profileReasons: profileDecisions
  };
}
