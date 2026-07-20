import { createHash } from 'node:crypto';
import type { TorqueWrenchRejectionReason } from '@raspi-system/shared-types';
import { Prisma } from '@prisma/client';
import { TorqueUnitConverter } from './torque-unit-converter.js';
import { normalizeFastenerText } from './torque-wrench-normalization.js';

export type TorqueCondition = {
  templateBoltId: string;
  nominalDiameter: string | null;
  boltLengthMm: Prisma.Decimal.Value | null;
  material: string | null;
  strengthClass: string | null;
  capabilityGroupId: string | null;
  lowerLimit: Prisma.Decimal.Value;
  nominalTorque: Prisma.Decimal.Value;
  upperLimit: Prisma.Decimal.Value;
  unit: string;
};

export type TorqueWrenchCandidate = {
  profileId: string;
  modelId: string;
  status: string;
  calibrationExpiryDate: Date | null;
  modelTorqueMinNm: Prisma.Decimal.Value;
  modelTorqueMaxNm: Prisma.Decimal.Value;
  capabilityGroupId: string | null;
  capabilityGroupIsActive: boolean;
  capabilityGroupNominalDiameter: string;
  capabilityGroupBoltLengthMm: Prisma.Decimal.Value;
  capabilityGroupMaterial: string;
  capabilityGroupStrengthClass: string;
  capabilityModelIds: string[];
  setting:
    | {
        id: string;
        lowerLimitNm: Prisma.Decimal.Value;
        nominalTorqueNm: Prisma.Decimal.Value;
        upperLimitNm: Prisma.Decimal.Value;
      }
    | null;
};

export type EligibilityDecision =
  | { eligible: true; conditionFingerprint: string }
  | { eligible: false; reason: TorqueWrenchRejectionReason };

function tokyoDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function requiredConditionMatchesGroup(condition: TorqueCondition, candidate: TorqueWrenchCandidate): boolean {
  return Boolean(
    condition.capabilityGroupId &&
      condition.nominalDiameter &&
      condition.boltLengthMm != null &&
      condition.material &&
      condition.strengthClass &&
      candidate.capabilityGroupId === condition.capabilityGroupId &&
      candidate.capabilityGroupIsActive &&
      normalizeFastenerText(condition.nominalDiameter) === candidate.capabilityGroupNominalDiameter &&
      new Prisma.Decimal(condition.boltLengthMm).equals(candidate.capabilityGroupBoltLengthMm) &&
      normalizeFastenerText(condition.material) === candidate.capabilityGroupMaterial &&
      normalizeFastenerText(condition.strengthClass) === candidate.capabilityGroupStrengthClass &&
      candidate.capabilityModelIds.includes(candidate.modelId)
  );
}

export function torqueConditionFingerprint(condition: TorqueCondition): string {
  const values = [
    normalizeFastenerText(condition.nominalDiameter ?? ''),
    condition.boltLengthMm == null ? '' : new Prisma.Decimal(condition.boltLengthMm).toString(),
    normalizeFastenerText(condition.material ?? ''),
    normalizeFastenerText(condition.strengthClass ?? ''),
    condition.capabilityGroupId ?? '',
    TorqueUnitConverter.toNewtonMetres(condition.lowerLimit, condition.unit).toString(),
    TorqueUnitConverter.toNewtonMetres(condition.nominalTorque, condition.unit).toString(),
    TorqueUnitConverter.toNewtonMetres(condition.upperLimit, condition.unit).toString()
  ];
  return createHash('sha256').update(values.join('|')).digest('hex');
}

export class TorqueWrenchEligibilityPolicy {
  evaluate(condition: TorqueCondition, candidate: TorqueWrenchCandidate, now = new Date()): EligibilityDecision {
    if (!requiredConditionMatchesGroup(condition, candidate)) {
      return { eligible: false, reason: 'WRONG_CAPABILITY_GROUP' };
    }
    if (!['AVAILABLE', 'IN_USE'].includes(candidate.status)) {
      return { eligible: false, reason: 'INSTRUMENT_STATUS_NOT_ELIGIBLE' };
    }
    if (!candidate.calibrationExpiryDate) {
      return { eligible: false, reason: 'CALIBRATION_MISSING' };
    }
    if (tokyoDateKey(candidate.calibrationExpiryDate) < tokyoDateKey(now)) {
      return { eligible: false, reason: 'CALIBRATION_EXPIRED' };
    }
    if (!candidate.setting) {
      return { eligible: false, reason: 'SETTING_HISTORY_MISSING' };
    }

    const lowerNm = TorqueUnitConverter.toNewtonMetres(condition.lowerLimit, condition.unit);
    const nominalNm = TorqueUnitConverter.toNewtonMetres(condition.nominalTorque, condition.unit);
    const upperNm = TorqueUnitConverter.toNewtonMetres(condition.upperLimit, condition.unit);
    const modelMin = new Prisma.Decimal(candidate.modelTorqueMinNm);
    const modelMax = new Prisma.Decimal(candidate.modelTorqueMaxNm);
    if (modelMin.gt(lowerNm) || modelMax.lt(upperNm) || modelMin.gt(nominalNm) || modelMax.lt(nominalNm)) {
      return { eligible: false, reason: 'MODEL_RANGE_NOT_COVERED' };
    }
    if (
      !new Prisma.Decimal(candidate.setting.lowerLimitNm).equals(lowerNm) ||
      !new Prisma.Decimal(candidate.setting.nominalTorqueNm).equals(nominalNm) ||
      !new Prisma.Decimal(candidate.setting.upperLimitNm).equals(upperNm)
    ) {
      return { eligible: false, reason: 'SETTING_MISMATCH' };
    }
    return { eligible: true, conditionFingerprint: torqueConditionFingerprint(condition) };
  }
}
