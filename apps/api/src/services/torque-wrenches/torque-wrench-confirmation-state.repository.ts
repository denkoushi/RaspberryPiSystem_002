import { Prisma } from '@prisma/client';

import type {
  TorqueWrenchConfirmationEvidence,
  TorqueWrenchLeaseEvidence
} from './torque-wrench-confirmation-use.policy.js';

type ConfirmationStateDb = Pick<
  Prisma.TransactionClient,
  'assemblyTorqueWrenchConfirmation' | 'torqueWrenchConnectionLease'
>;

const confirmationEvidenceSelect = {
  id: true,
  sessionId: true,
  torqueWrenchProfileId: true,
  settingHistoryId: true,
  conditionFingerprint: true,
  clientDeviceId: true,
  confirmedAt: true
} satisfies Prisma.AssemblyTorqueWrenchConfirmationSelect;

const leaseEvidenceSelect = {
  leaseId: true,
  generation: true,
  adoptedConfirmationId: true,
  ownerClientDeviceId: true,
  ownerSessionId: true,
  acquiredAt: true,
  expiresAt: true,
  releasedAt: true
} satisfies Prisma.TorqueWrenchConnectionLeaseSelect;

export class TorqueWrenchConfirmationStateRepository {
  async findConfirmation(
    db: ConfirmationStateDb,
    confirmationId: string
  ): Promise<TorqueWrenchConfirmationEvidence | null> {
    return db.assemblyTorqueWrenchConfirmation.findUnique({
      where: { id: confirmationId },
      select: confirmationEvidenceSelect
    });
  }

  async findLease(
    db: ConfirmationStateDb,
    torqueWrenchProfileId: string
  ): Promise<TorqueWrenchLeaseEvidence | null> {
    return db.torqueWrenchConnectionLease.findUnique({
      where: { torqueWrenchProfileId },
      select: leaseEvidenceSelect
    });
  }

  async listLeases(
    db: ConfirmationStateDb,
    torqueWrenchProfileIds: string[]
  ): Promise<Array<{
    torqueWrenchProfileId: string;
    lease: TorqueWrenchLeaseEvidence;
  }>> {
    if (torqueWrenchProfileIds.length === 0) return [];
    const rows = await db.torqueWrenchConnectionLease.findMany({
      where: { torqueWrenchProfileId: { in: torqueWrenchProfileIds } },
      select: {
        torqueWrenchProfileId: true,
        ...leaseEvidenceSelect
      }
    });
    return rows.map(({ torqueWrenchProfileId, ...lease }) => ({
      torqueWrenchProfileId,
      lease
    }));
  }

  async listCurrentSession(
    db: ConfirmationStateDb,
    input: {
      sessionId: string;
      clientDeviceId?: string;
      conditionFingerprint: string;
    }
  ): Promise<TorqueWrenchConfirmationEvidence[]> {
    return db.assemblyTorqueWrenchConfirmation.findMany({
      where: {
        sessionId: input.sessionId,
        ...(input.clientDeviceId ? { clientDeviceId: input.clientDeviceId } : {}),
        conditionFingerprint: input.conditionFingerprint
      },
      select: confirmationEvidenceSelect,
      orderBy: { confirmedAt: 'desc' }
    });
  }

  async listAdoptedForClient(
    db: ConfirmationStateDb,
    input: {
      clientDeviceId: string;
      torqueWrenchProfileIds: string[];
    }
  ): Promise<Array<{
    confirmation: TorqueWrenchConfirmationEvidence;
    lease: TorqueWrenchLeaseEvidence;
  }>> {
    if (input.torqueWrenchProfileIds.length === 0) return [];
    const leases = await db.torqueWrenchConnectionLease.findMany({
      where: {
        torqueWrenchProfileId: { in: input.torqueWrenchProfileIds },
        ownerClientDeviceId: input.clientDeviceId,
        adoptedConfirmationId: { not: null }
      },
      select: {
        torqueWrenchProfileId: true,
        ...leaseEvidenceSelect
      }
    });
    const confirmationIds = leases.flatMap((lease) =>
      lease.adoptedConfirmationId ? [lease.adoptedConfirmationId] : []
    );
    if (confirmationIds.length === 0) return [];
    const confirmations = await db.assemblyTorqueWrenchConfirmation.findMany({
      where: { id: { in: confirmationIds } },
      select: confirmationEvidenceSelect
    });
    const byId = new Map(confirmations.map((confirmation) => [confirmation.id, confirmation]));
    return leases.flatMap((lease) => {
      const confirmation = lease.adoptedConfirmationId
        ? byId.get(lease.adoptedConfirmationId)
        : undefined;
      return confirmation ? [{ confirmation, lease }] : [];
    });
  }
}
