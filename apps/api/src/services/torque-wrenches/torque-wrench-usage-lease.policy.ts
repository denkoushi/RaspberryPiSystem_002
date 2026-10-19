import type { TorqueWrenchConnectionLeaseState, TorqueWrenchConnectionLeaseStatusDto } from '@raspi-system/shared-types';
import { Prisma } from '@prisma/client';

export type UsageLeaseOwnerKind = 'ASSEMBLY' | 'TRAINING';

export const TORQUE_USAGE_LEASE_TTL_MS = 8_000;
export const TORQUE_USAGE_LEASE_HANDOFF_GRACE_MS = 1_000;

export type UsageLeaseOwnerIdentity = {
  ownerKind: UsageLeaseOwnerKind;
  clientDeviceId: string;
  sessionId: string;
};

export type UsageLeaseViewer = Pick<UsageLeaseOwnerIdentity, 'ownerKind' | 'clientDeviceId'> & {
  sessionId?: string;
};

export type UsageLeaseToken = {
  torqueWrenchProfileId: string;
  leaseId: string;
  generation: number;
};

type UsageLeaseRowForPolicy = {
  ownerKind: UsageLeaseOwnerKind;
  ownerClientDeviceId: string;
  ownerAssemblySessionId: string | null;
  ownerTrainingSessionId: string | null;
  generation: number;
  leaseId: string;
  expiresAt: Date;
  connectAfter: Date;
  releasedAt: Date | null;
};

export function ownerSessionId(row: Pick<UsageLeaseRowForPolicy, 'ownerKind' | 'ownerAssemblySessionId' | 'ownerTrainingSessionId'>): string | null {
  return row.ownerKind === 'ASSEMBLY' ? row.ownerAssemblySessionId : row.ownerTrainingSessionId;
}

export function isUsageLeaseActive(row: Pick<UsageLeaseRowForPolicy, 'releasedAt' | 'expiresAt'>, now: Date): boolean {
  return row.releasedAt === null && row.expiresAt.getTime() > now.getTime();
}

export function isSameUsageLeaseOwner(
  row: Pick<UsageLeaseRowForPolicy, 'ownerKind' | 'ownerClientDeviceId' | 'ownerAssemblySessionId' | 'ownerTrainingSessionId'>,
  owner: UsageLeaseOwnerIdentity
): boolean {
  return row.ownerKind === owner.ownerKind
    && row.ownerClientDeviceId === owner.clientDeviceId
    && ownerSessionId(row) === owner.sessionId;
}

export function isSameUsageLeaseToken(
  row: Pick<UsageLeaseRowForPolicy, 'leaseId' | 'generation'> | null,
  token: Pick<UsageLeaseToken, 'leaseId' | 'generation'>
): boolean {
  return row !== null && row.leaseId === token.leaseId && row.generation === token.generation;
}

/**
 * A status viewer is allowed to see a token only when its owner kind and
 * client match. The public status routes intentionally do not require a
 * session ID, so the owner kind is the important boundary for a kiosk that
 * reuses one physical client for assembly and training.
 */
export function isUsageLeaseSelfView(
  row: Pick<UsageLeaseRowForPolicy, 'ownerKind' | 'ownerClientDeviceId' | 'ownerAssemblySessionId' | 'ownerTrainingSessionId'>,
  viewer: UsageLeaseViewer
): boolean {
  if (row.ownerKind !== viewer.ownerKind || row.ownerClientDeviceId !== viewer.clientDeviceId) return false;
  return viewer.sessionId === undefined || ownerSessionId(row) === viewer.sessionId;
}

export function nextUsageLeaseConnectAfter(
  previous: Pick<UsageLeaseRowForPolicy, 'connectAfter' | 'releasedAt'> | null,
  now: Date,
  options: { sameOwner: boolean; takeover: boolean; previousExpiresAt?: Date }
): Date {
  if (
    options.sameOwner
    && !options.takeover
    && previous
    && previous.releasedAt === null
    && previous.connectAfter.getTime() > now.getTime()
  ) {
    return previous.connectAfter;
  }
  if (options.takeover && options.previousExpiresAt && options.previousExpiresAt.getTime() > now.getTime()) {
    return new Date(options.previousExpiresAt.getTime() + TORQUE_USAGE_LEASE_HANDOFF_GRACE_MS);
  }
  return now;
}

function ownerSnapshot(
  row: UsageLeaseRowForPolicy & { ownerClientDevice: { name: string; location: string | null } },
  includePrivateIdentity: boolean
): NonNullable<TorqueWrenchConnectionLeaseStatusDto['owner']> {
  return {
    ownerKind: row.ownerKind,
    clientDeviceName: row.ownerClientDevice.name,
    clientDeviceLocation: row.ownerClientDevice.location,
    ...(includePrivateIdentity
      ? {
          clientDeviceId: row.ownerClientDeviceId,
          sessionId: ownerSessionId(row) ?? undefined
        }
      : {})
  };
}

export function serializeUsageLeaseStatus(
  torqueWrenchProfileId: string,
  row: (UsageLeaseRowForPolicy & { ownerClientDevice: { name: string; location: string | null } }) | null,
  viewer: UsageLeaseViewer,
  now = new Date()
): TorqueWrenchConnectionLeaseStatusDto {
  if (!row) {
    return {
      torqueWrenchProfileId,
      state: 'available',
      owner: null,
      expiresAt: null,
      connectAfter: null
    };
  }

  const expired = row.expiresAt.getTime() <= now.getTime();
  const released = row.releasedAt !== null;
  const self = isUsageLeaseSelfView(row, viewer);
  const waiting = self && !released && !expired && row.connectAfter.getTime() > now.getTime();
  const state: TorqueWrenchConnectionLeaseState = released
    ? 'available'
    : expired
      ? 'expired'
      : waiting
        ? 'handoff_wait'
        : self
          ? 'owned_by_self'
          : 'owned_by_other';

  return {
    torqueWrenchProfileId,
    state,
    owner: released ? null : ownerSnapshot(row, self),
    expiresAt: released ? null : row.expiresAt.toISOString(),
    connectAfter: released ? null : row.connectAfter.toISOString(),
    ...(self && !released && !expired
      ? { leaseId: row.leaseId, generation: row.generation }
      : {})
  };
}

export function ownerFields(owner: UsageLeaseOwnerIdentity) {
  return {
    ownerKind: owner.ownerKind,
    ownerAssemblySessionId: owner.ownerKind === 'ASSEMBLY' ? owner.sessionId : null,
    ownerTrainingSessionId: owner.ownerKind === 'TRAINING' ? owner.sessionId : null,
    ownerClientDeviceId: owner.clientDeviceId
  } satisfies Pick<
    Prisma.TorqueWrenchUsageLeaseUncheckedCreateInput,
    'ownerKind' | 'ownerAssemblySessionId' | 'ownerTrainingSessionId' | 'ownerClientDeviceId'
  >;
}
