import { Prisma } from '@prisma/client';

import { lockTorqueWrenchProfile } from './torque-wrench-lock.repository.js';
import type { UsageLeaseOwnerIdentity } from './torque-wrench-usage-lease.policy.js';

export const torqueWrenchUsageLeaseInclude = {
  ownerClientDevice: {
    select: { id: true, name: true, location: true }
  }
} satisfies Prisma.TorqueWrenchUsageLeaseInclude;

export type TorqueWrenchUsageLeaseRow = Prisma.TorqueWrenchUsageLeaseGetPayload<{
  include: typeof torqueWrenchUsageLeaseInclude;
}>;

export type UsageLeaseDb = Pick<
  Prisma.TransactionClient,
  'torqueWrenchUsageLease' | 'torqueWrenchUsageLeaseHistory' | 'clientDevice'
>;

export type UsageLeaseHistoryInput = {
  profileId: string;
  leaseId: string;
  generation: number;
  owner: UsageLeaseOwnerIdentity;
  ownerClientDeviceName: string;
  action: string;
  adoptedConfirmationId?: string | null;
  reason?: string | null;
};

export class TorqueWrenchUsageLeaseRepository {
  async lockProfile(tx: Prisma.TransactionClient, torqueWrenchProfileId: string): Promise<void> {
    await lockTorqueWrenchProfile(tx, torqueWrenchProfileId);
  }

  async find(db: UsageLeaseDb, torqueWrenchProfileId: string): Promise<TorqueWrenchUsageLeaseRow | null> {
    return db.torqueWrenchUsageLease.findUnique({
      where: { torqueWrenchProfileId },
      include: torqueWrenchUsageLeaseInclude
    });
  }

  async findWithoutDevice(
    db: UsageLeaseDb,
    torqueWrenchProfileId: string
  ): Promise<Prisma.TorqueWrenchUsageLeaseGetPayload<object> | null> {
    return db.torqueWrenchUsageLease.findUnique({ where: { torqueWrenchProfileId } });
  }

  async listForOwner(
    db: UsageLeaseDb,
    owner: UsageLeaseOwnerIdentity
  ): Promise<Array<{ torqueWrenchProfileId: string }>> {
    return db.torqueWrenchUsageLease.findMany({
      where: {
        ownerKind: owner.ownerKind,
        ownerClientDeviceId: owner.clientDeviceId,
        ...(owner.ownerKind === 'ASSEMBLY'
          ? { ownerAssemblySessionId: owner.sessionId }
          : { ownerTrainingSessionId: owner.sessionId }),
        releasedAt: null
      },
      select: { torqueWrenchProfileId: true }
    });
  }

  async findClient(
    db: UsageLeaseDb,
    clientDeviceId: string
  ): Promise<{ id: string; name: string; location: string | null } | null> {
    return db.clientDevice.findUnique({
      where: { id: clientDeviceId },
      select: { id: true, name: true, location: true }
    });
  }

  async appendHistory(tx: Prisma.TransactionClient, input: UsageLeaseHistoryInput): Promise<void> {
    await tx.torqueWrenchUsageLeaseHistory.create({
      data: {
        torqueWrenchProfileId: input.profileId,
        leaseId: input.leaseId,
        generation: input.generation,
        ownerKind: input.owner.ownerKind,
        ownerTargetId: input.owner.sessionId,
        ownerClientDeviceId: input.owner.clientDeviceId,
        ownerClientDeviceName: input.ownerClientDeviceName,
        action: input.action,
        adoptedConfirmationId: input.adoptedConfirmationId ?? null,
        reason: input.reason?.trim().slice(0, 500) || null
      }
    });
  }
}
