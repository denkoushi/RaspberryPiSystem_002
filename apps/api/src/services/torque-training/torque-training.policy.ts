import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { TorqueUnitConverter } from '../torque-wrenches/torque-unit-converter.js';

export type TrainingJudgement = 'OK' | 'UNDER' | 'OVER';

export type TrainingConditionInput = {
  nominalDiameter: string;
  boltLengthMm: Prisma.Decimal.Value;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  lowerLimit: Prisma.Decimal.Value;
  nominalTorque: Prisma.Decimal.Value;
  upperLimit: Prisma.Decimal.Value;
  unit: string;
  jigConditionCode: string;
};

export type TrainingAttemptDecision = {
  judgement: TrainingJudgement;
  accepted: true;
  valueNm: Prisma.Decimal;
  nominalNm: Prisma.Decimal;
  lowerNm: Prisma.Decimal;
  upperNm: Prisma.Decimal;
  deviationNm: Prisma.Decimal;
  deviationPercent: Prisma.Decimal;
  absoluteDeviationPercent: Prisma.Decimal;
};

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function trainingConditionFingerprint(input: TrainingConditionInput): string {
  const values = [
    normalized(input.nominalDiameter),
    new Prisma.Decimal(input.boltLengthMm).toString(),
    normalized(input.material),
    normalized(input.strengthClass),
    input.capabilityGroupId,
    normalized(input.unit),
    TorqueUnitConverter.toNewtonMetres(input.lowerLimit, input.unit).toString(),
    TorqueUnitConverter.toNewtonMetres(input.nominalTorque, input.unit).toString(),
    TorqueUnitConverter.toNewtonMetres(input.upperLimit, input.unit).toString(),
    normalized(input.jigConditionCode)
  ];
  return createHash('sha256').update(values.join('|')).digest('hex');
}

export function decideTrainingAttempt(
  value: Prisma.Decimal.Value,
  unit: string,
  condition: Pick<TrainingConditionInput, 'lowerLimit' | 'nominalTorque' | 'upperLimit' | 'unit'>
): TrainingAttemptDecision {
  const valueNm = TorqueUnitConverter.toNewtonMetres(value, unit);
  const lowerNm = TorqueUnitConverter.toNewtonMetres(condition.lowerLimit, condition.unit);
  const nominalNm = TorqueUnitConverter.toNewtonMetres(condition.nominalTorque, condition.unit);
  const upperNm = TorqueUnitConverter.toNewtonMetres(condition.upperLimit, condition.unit);
  const deviationNm = valueNm.minus(nominalNm);
  const deviationPercent = nominalNm.isZero() ? new Prisma.Decimal(0) : deviationNm.div(nominalNm).mul(100);
  const absoluteDeviationPercent = deviationPercent.abs();
  const judgement: TrainingJudgement = valueNm.lt(lowerNm) ? 'UNDER' : valueNm.gt(upperNm) ? 'OVER' : 'OK';
  return {
    judgement,
    accepted: true,
    valueNm,
    nominalNm,
    lowerNm,
    upperNm,
    deviationNm,
    deviationPercent,
    absoluteDeviationPercent
  };
}

export type TrainingMetricRow = {
  accepted: boolean;
  judgement: TrainingJudgement | 'IGNORED';
  deviationPercent: Prisma.Decimal.Value | null;
  absoluteDeviationPercent: Prisma.Decimal.Value | null;
};

export function summarizeTrainingAttempts(rows: TrainingMetricRow[]) {
  const accepted = rows.filter((row) => row.accepted && row.deviationPercent != null);
  if (accepted.length === 0) {
    return { attemptCount: 0, passRate: 0, meanAbsoluteErrorPercent: 0, variationPercent: 0 };
  }
  const signed = accepted.map((row) => Number(row.deviationPercent));
  const absolute = accepted.map((row) => Number(row.absoluteDeviationPercent));
  const okCount = accepted.filter((row) => row.judgement === 'OK').length;
  const mean = signed.reduce((sum, value) => sum + value, 0) / signed.length;
  const variation = Math.sqrt(signed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / signed.length);
  return {
    attemptCount: accepted.length,
    passRate: okCount / accepted.length,
    meanAbsoluteErrorPercent: absolute.reduce((sum, value) => sum + value, 0) / absolute.length,
    variationPercent: variation
  };
}
