import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { runTrainingTransaction } from './torque-training.transaction.js';
import {
  isSameUsageLeaseOwner,
  isSameUsageLeaseToken,
  isUsageLeaseActive,
  type UsageLeaseOwnerIdentity
} from '../torque-wrenches/torque-wrench-usage-lease.policy.js';
import {
  TorqueWrenchUsageLeaseCoordinator,
  type UsageLeaseAcquireActionContext,
  type UsageLeaseAcquireInput,
  type UsageLeaseOwnerAdapter,
  type UsageLeaseReleaseResponse
} from '../torque-wrenches/torque-wrench-usage-lease.coordinator.js';
import { TorqueWrenchUsageLeaseRepository } from '../torque-wrenches/torque-wrench-usage-lease.repository.js';

export type TrainingLeaseAcquireInput = {
  sessionId: string;
  profileId: string;
  confirmationId: string;
  clientDeviceId: string;
  requestId: string;
  takeover?: boolean;
  physicalWrenchPresent?: boolean;
  reason?: string | null;
};

export type TrainingLeaseTokenInput = {
  sessionId: string;
  profileId: string;
  clientDeviceId: string;
  leaseId: string;
  generation: number;
  reason?: string | null;
};

type TrainingLeaseEventInput = {
  sessionId: string;
  profileId: string;
  clientDeviceId: string;
  leaseId?: string | null;
  generation?: number | null;
};

class TrainingTorqueWrenchLeaseAdapter implements UsageLeaseOwnerAdapter {
  readonly owner: UsageLeaseOwnerIdentity;
  readonly releaseAction = 'RELEASE';
  readonly defaultReleaseReason = 'CLIENT_RELEASE';

  constructor(
    sessionId: string,
    clientDeviceId: string
  ) {
    this.owner = {
      ownerKind: 'TRAINING',
      clientDeviceId,
      sessionId
    };
  }

  async validateAcquire(
    tx: Prisma.TransactionClient,
    input: UsageLeaseAcquireInput
  ): Promise<void> {
    const session = await tx.torqueTrainingSession.findUnique({
      where: { id: this.owner.sessionId }
    });
    if (
      !session
      || session.clientDeviceId !== this.owner.clientDeviceId
      || session.status !== 'IN_PROGRESS'
    ) {
      throw new ApiError(409, '訓練セッションが接続可能な状態ではありません');
    }
    const confirmation = await tx.torqueTrainingWrenchConfirmation.findFirst({
      where: {
        id: input.confirmationId,
        sessionId: this.owner.sessionId,
        torqueWrenchProfileId: input.torqueWrenchProfileId
      }
    });
    if (!confirmation) {
      throw new ApiError(409, 'レンチ確認が必要です', undefined, 'CONFIRMATION_REQUIRED');
    }
  }

  acquireAction(context: UsageLeaseAcquireActionContext): string | null {
    if (context.takeover && context.previousActive) return 'TAKEN_OVER';
    if (context.sameOwner && context.previousActive) return 'RENEWED';
    return 'ACQUIRE';
  }
}

/**
 * Training's lease boundary. Session scoring and attempt persistence stay in
 * TorqueTrainingService; all current-row locking, fencing and history writes
 * are delegated to the common usage-lease coordinator.
 */
export class TorqueTrainingLeaseService {
  private readonly coordinator: TorqueWrenchUsageLeaseCoordinator;

  constructor(
    repository = new TorqueWrenchUsageLeaseRepository()
  ) {
    this.coordinator = new TorqueWrenchUsageLeaseCoordinator(repository);
  }

  async acquire(input: TrainingLeaseAcquireInput) {
    if (input.takeover && input.physicalWrenchPresent !== true) {
      throw new ApiError(400, '現物のトルクレンチが手元にあることを確認してください');
    }
    if (input.takeover && !input.reason?.trim()) {
      throw new ApiError(400, '引継ぎ理由が必要です');
    }
    const adapter = new TrainingTorqueWrenchLeaseAdapter(input.sessionId, input.clientDeviceId);
    return runTrainingTransaction((tx) => this.coordinator.acquire(
      tx,
      {
        torqueWrenchProfileId: input.profileId,
        confirmationId: input.confirmationId,
        requestId: input.requestId,
        takeover: input.takeover === true,
        physicalWrenchPresent: input.physicalWrenchPresent,
        reason: input.reason
      },
      adapter
    ));
  }

  async renew(input: TrainingLeaseTokenInput) {
    return runTrainingTransaction((tx) => this.coordinator.renew(tx, {
      torqueWrenchProfileId: input.profileId,
      leaseId: input.leaseId,
      generation: input.generation,
      owner: {
        ownerKind: 'TRAINING',
        clientDeviceId: input.clientDeviceId,
        sessionId: input.sessionId
      }
    }));
  }

  async release(input: TrainingLeaseTokenInput): Promise<UsageLeaseReleaseResponse> {
    return runTrainingTransaction((tx) => this.coordinator.release(
      tx,
      {
        torqueWrenchProfileId: input.profileId,
        leaseId: input.leaseId,
        generation: input.generation,
        owner: {
          ownerKind: 'TRAINING',
          clientDeviceId: input.clientDeviceId,
          sessionId: input.sessionId
        },
        reason: input.reason
      },
      'CLIENT_RELEASE',
      'RELEASE'
    ));
  }

  async releaseForSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
    clientDeviceId: string,
    reason: string
  ): Promise<void> {
    await this.coordinator.releaseForOwner(
      tx,
      { ownerKind: 'TRAINING', clientDeviceId, sessionId },
      reason,
      'RELEASE'
    );
  }

  async releaseExactInTransaction(
    tx: Prisma.TransactionClient,
    input: TrainingLeaseTokenInput,
    reason: string
  ): Promise<UsageLeaseReleaseResponse> {
    return this.coordinator.release(
      tx,
      {
        torqueWrenchProfileId: input.profileId,
        leaseId: input.leaseId,
        generation: input.generation,
        owner: {
          ownerKind: 'TRAINING',
          clientDeviceId: input.clientDeviceId,
          sessionId: input.sessionId
        },
        reason
      },
      reason,
      'RELEASE'
    );
  }

  /**
   * Training deliberately checks expiry at event send time. Assembly has a
   * different outbox policy, so this helper is kept in the training adapter
   * instead of being folded into the common coordinator.
   */
  async isCurrentForAttempt(
    tx: Prisma.TransactionClient,
    input: TrainingLeaseEventInput,
    now = new Date()
  ): Promise<boolean> {
    const generation = input.generation;
    if (!input.leaseId || typeof generation !== 'number' || !Number.isInteger(generation) || generation <= 0) return false;
    await this.coordinator.lockProfile(tx, input.profileId);
    const current = await tx.torqueWrenchUsageLease.findUnique({
      where: { torqueWrenchProfileId: input.profileId }
    });
    if (!current || !isUsageLeaseActive(current, now)) return false;
    return isSameUsageLeaseOwner(current, {
      ownerKind: 'TRAINING',
      clientDeviceId: input.clientDeviceId,
      sessionId: input.sessionId
    }) && isSameUsageLeaseToken(current, {
      leaseId: input.leaseId,
      generation
    });
  }
}
