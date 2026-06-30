import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export const SELF_INSPECTION_REGISTRATION_POLICY_KEY = 'shared';

export type SelfInspectionRegistrationPolicy = {
  key: typeof SELF_INSPECTION_REGISTRATION_POLICY_KEY;
  requireMeasuringInstrumentTag: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
};

export type SelfInspectionRegistrationRequirementPolicy = Pick<
  SelfInspectionRegistrationPolicy,
  'requireMeasuringInstrumentTag'
>;

type RegistrationPolicyDb = Pick<Prisma.TransactionClient, 'selfInspectionRegistrationPolicyConfig'>;

type EntryRegistrationFields = {
  createdByEmployeeId: string | null;
  measuringInstrumentId: string | null;
  measuringInstrumentUsageCount?: number | null;
};

function defaultSelfInspectionRegistrationPolicy(): SelfInspectionRegistrationPolicy {
  return {
    key: SELF_INSPECTION_REGISTRATION_POLICY_KEY,
    requireMeasuringInstrumentTag: false,
    updatedAt: null,
    updatedBy: null
  };
}

export async function getSelfInspectionRegistrationPolicy(
  db: RegistrationPolicyDb = prisma
): Promise<SelfInspectionRegistrationPolicy> {
  const row = await db.selfInspectionRegistrationPolicyConfig.findUnique({
    where: { key: SELF_INSPECTION_REGISTRATION_POLICY_KEY },
    select: {
      key: true,
      requireMeasuringInstrumentTag: true,
      updatedAt: true,
      updatedBy: true
    }
  });
  if (!row) {
    return defaultSelfInspectionRegistrationPolicy();
  }
  return {
    key: SELF_INSPECTION_REGISTRATION_POLICY_KEY,
    requireMeasuringInstrumentTag: row.requireMeasuringInstrumentTag,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy
  };
}

export async function updateSelfInspectionRegistrationPolicy(input: {
  requireMeasuringInstrumentTag: boolean;
  updatedBy?: string | null;
}): Promise<SelfInspectionRegistrationPolicy> {
  const updatedBy = input.updatedBy?.trim() || null;
  const row = await prisma.selfInspectionRegistrationPolicyConfig.upsert({
    where: { key: SELF_INSPECTION_REGISTRATION_POLICY_KEY },
    create: {
      key: SELF_INSPECTION_REGISTRATION_POLICY_KEY,
      requireMeasuringInstrumentTag: input.requireMeasuringInstrumentTag,
      updatedBy
    },
    update: {
      requireMeasuringInstrumentTag: input.requireMeasuringInstrumentTag,
      updatedBy
    },
    select: {
      key: true,
      requireMeasuringInstrumentTag: true,
      updatedAt: true,
      updatedBy: true
    }
  });
  return {
    key: SELF_INSPECTION_REGISTRATION_POLICY_KEY,
    requireMeasuringInstrumentTag: row.requireMeasuringInstrumentTag,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy
  };
}

export function isSelfInspectionLotEntryRegistrationCompleteForPolicy(
  entry: EntryRegistrationFields,
  policy: SelfInspectionRegistrationRequirementPolicy
): boolean {
  if (!entry.createdByEmployeeId) {
    return false;
  }
  const hasMeasuringInstrumentUsage =
    Boolean(entry.measuringInstrumentId) ||
    (entry.measuringInstrumentUsageCount != null && entry.measuringInstrumentUsageCount > 0);
  if (policy.requireMeasuringInstrumentTag && !hasMeasuringInstrumentUsage) {
    return false;
  }
  return true;
}
