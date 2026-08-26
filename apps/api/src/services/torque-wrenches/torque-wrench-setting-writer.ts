import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { TorqueUnitConverter } from './torque-unit-converter.js';
import { lockTorqueWrenchProfile } from './torque-wrench-lock.repository.js';

/** The append-only setting payload shared by admin and training workflows. */
export type TorqueWrenchSettingInput = {
  lowerLimit: Prisma.Decimal.Value;
  nominalTorque: Prisma.Decimal.Value;
  upperLimit: Prisma.Decimal.Value;
  unit: string;
  effectiveAt?: Date;
  reason?: string | null;
  actorUserId?: string | null;
  actorUsername?: string | null;
};

function assertRange(lowerLimit: Prisma.Decimal, nominalTorque: Prisma.Decimal, upperLimit: Prisma.Decimal): void {
  if (lowerLimit.gt(nominalTorque) || nominalTorque.gt(upperLimit)) {
    throw new ApiError(400, '下限値 ≤ 規定値 ≤ 上限値となるよう設定してください');
  }
}

/**
 * Append one validated setting row inside the caller's transaction.
 *
 * The writer owns normalization and range checks, while callers own the
 * transaction boundary and the business meaning of the actor/reason fields.
 */
export async function appendTorqueWrenchSetting(
  tx: Prisma.TransactionClient,
  profileId: string,
  input: TorqueWrenchSettingInput
) {
  const lowerLimit = new Prisma.Decimal(input.lowerLimit);
  const nominalTorque = new Prisma.Decimal(input.nominalTorque);
  const upperLimit = new Prisma.Decimal(input.upperLimit);
  assertRange(lowerLimit, nominalTorque, upperLimit);

  const lowerLimitNm = TorqueUnitConverter.toNewtonMetres(lowerLimit, input.unit);
  const nominalTorqueNm = TorqueUnitConverter.toNewtonMetres(nominalTorque, input.unit);
  const upperLimitNm = TorqueUnitConverter.toNewtonMetres(upperLimit, input.unit);
  const effectiveAt = input.effectiveAt ?? new Date();
  if (effectiveAt.getTime() > Date.now()) {
    throw new ApiError(400, '適用日時に未来の日時は指定できません');
  }

  await lockTorqueWrenchProfile(tx, profileId);
  const profile = await tx.torqueWrenchProfile.findUnique({
    where: { id: profileId },
    include: { model: true }
  });
  if (!profile) throw new ApiError(404, '物理トルクレンチが見つかりません');
  if (profile.model.torqueMinNm.gt(lowerLimitNm) || profile.model.torqueMaxNm.lt(upperLimitNm)) {
    throw new ApiError(400, '設定値が型番の測定可能範囲外です');
  }

  return tx.torqueWrenchSettingHistory.create({
    data: {
      torqueWrenchProfileId: profileId,
      lowerLimit,
      nominalTorque,
      upperLimit,
      unit: TorqueUnitConverter.canonicalUnit(input.unit),
      lowerLimitNm,
      nominalTorqueNm,
      upperLimitNm,
      effectiveAt,
      actorUserId: input.actorUserId ?? null,
      actorUsername: input.actorUsername?.slice(0, 120) ?? null,
      reason: input.reason?.trim().slice(0, 500) || null
    }
  });
}
