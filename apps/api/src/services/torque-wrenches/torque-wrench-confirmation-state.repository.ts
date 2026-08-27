import { Prisma } from '@prisma/client';

import type {
  TorqueWrenchConfirmationEvidence,
  TorqueWrenchLeaseEvidence
} from './torque-wrench-confirmation-use.policy.js';

type ConfirmationStateDb = Pick<
  Prisma.TransactionClient,
  'assemblyTorqueWrenchConfirmation' | 'torqueTrainingWrenchConfirmation' | 'torqueWrenchUsageLease'
>;

const confirmationEvidenceSelect = {
  id: true,
  sessionId: true,
  torqueWrenchProfileId: true,
  settingHistoryId: true,
  settingVerificationMode: true,
  observedLeaseGeneration: true,
  observedAdoptedConfirmationId: true,
  conditionFingerprint: true,
  clientDeviceId: true,
  confirmedAt: true
} satisfies Prisma.AssemblyTorqueWrenchConfirmationSelect;

const trainingConfirmationEvidenceSelect = {
  id: true,
  sessionId: true,
  torqueWrenchProfileId: true,
  settingHistoryId: true,
  settingVerificationMode: true,
  observedLeaseGeneration: true,
  observedAdoptedConfirmationId: true,
  conditionFingerprint: true,
  clientDeviceId: true,
  confirmedAt: true
} satisfies Prisma.TorqueTrainingWrenchConfirmationSelect;

const leaseEvidenceSelect = {
  leaseId: true,
  generation: true,
  adoptedConfirmationId: true,
  ownerKind: true,
  ownerClientDeviceId: true,
  ownerAssemblySessionId: true,
  ownerTrainingSessionId: true,
  acquiredAt: true,
  expiresAt: true,
  releasedAt: true
} satisfies Prisma.TorqueWrenchUsageLeaseSelect;

function leaseEvidence(row: {
  leaseId: string;
  generation: number;
  adoptedConfirmationId: string | null;
  ownerKind: 'ASSEMBLY' | 'TRAINING';
  ownerClientDeviceId: string;
  ownerAssemblySessionId: string | null;
  ownerTrainingSessionId: string | null;
  acquiredAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
}): TorqueWrenchLeaseEvidence {
  return {
    leaseId: row.leaseId,
    generation: row.generation,
    adoptedConfirmationId: row.adoptedConfirmationId,
    ownerKind: row.ownerKind,
    ownerClientDeviceId: row.ownerClientDeviceId,
    ownerSessionId: row.ownerAssemblySessionId ?? row.ownerTrainingSessionId ?? '',
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt
  };
}

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

  async findTrainingConfirmation(
    db: ConfirmationStateDb,
    confirmationId: string
  ): Promise<TorqueWrenchConfirmationEvidence | null> {
    return db.torqueTrainingWrenchConfirmation.findUnique({
      where: { id: confirmationId },
      select: trainingConfirmationEvidenceSelect
    });
  }

  async findLease(
    db: ConfirmationStateDb,
    torqueWrenchProfileId: string
  ): Promise<TorqueWrenchLeaseEvidence | null> {
    const row = await db.torqueWrenchUsageLease.findUnique({
      where: { torqueWrenchProfileId },
      select: leaseEvidenceSelect
    });
    return row ? leaseEvidence(row) : null;
  }

  async listLeases(
    db: ConfirmationStateDb,
    torqueWrenchProfileIds: string[]
  ): Promise<Array<{
    torqueWrenchProfileId: string;
    lease: TorqueWrenchLeaseEvidence;
  }>> {
    if (torqueWrenchProfileIds.length === 0) return [];
    const rows = await db.torqueWrenchUsageLease.findMany({
      where: { torqueWrenchProfileId: { in: torqueWrenchProfileIds } },
      select: {
        torqueWrenchProfileId: true,
        ...leaseEvidenceSelect
      }
    });
    return rows.map(({ torqueWrenchProfileId, ...lease }) => ({
      torqueWrenchProfileId,
      lease: leaseEvidence(lease)
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
    const leases = await db.torqueWrenchUsageLease.findMany({
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
      return confirmation ? [{ confirmation, lease: leaseEvidence(lease) }] : [];
    });
  }
}
