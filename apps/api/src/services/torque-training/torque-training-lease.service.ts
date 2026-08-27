import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { runTrainingTransaction } from './torque-training.transaction.js';
import {
  TorqueWrenchConfirmationStateRepository
} from '../torque-wrenches/torque-wrench-confirmation-state.repository.js';
import {
  TorqueWrenchConfirmationUsePolicy,
  type TorqueWrenchConfirmationExpectation
} from '../torque-wrenches/torque-wrench-confirmation-use.policy.js';
import { TorqueWrenchEligibilityPolicy } from '../torque-wrenches/torque-wrench-eligibility.policy.js';
import {
  candidateFromProfile,
  profileEligibilityInclude
} from '../torque-wrenches/torque-wrench-use-context.js';
import {
  conditionFromTrainingVersion,
  trainingSetupVersionInclude
} from './torque-training-setup.service.js';
import {
  normalizeTorqueWrenchSettingVerificationMode,
  usesRegisteredTorqueWrenchSetting
} from '../torque-wrenches/torque-wrench-setting-mode.policy.js';
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
  confirmationId: string;
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
    clientDeviceId: string,
    private readonly confirmationPolicy: TorqueWrenchConfirmationUsePolicy,
    private readonly confirmationRepository: TorqueWrenchConfirmationStateRepository,
    private readonly eligibilityPolicy: TorqueWrenchEligibilityPolicy
  ) {
    this.owner = {
      ownerKind: 'TRAINING',
      clientDeviceId,
      sessionId
    };
  }

  async validateAcquire(
    tx: Prisma.TransactionClient,
    input: UsageLeaseAcquireInput,
    now: Date
  ): Promise<void> {
    const session = await tx.torqueTrainingSession.findUnique({
      where: { id: this.owner.sessionId },
      include: { programVersion: { include: trainingSetupVersionInclude } }
    });
    if (
      !session
      || session.clientDeviceId !== this.owner.clientDeviceId
      || session.status !== 'IN_PROGRESS'
    ) {
      throw new ApiError(409, '訓練セッションが接続可能な状態ではありません');
    }
    const [confirmation, profile, lease] = await Promise.all([
      this.confirmationRepository.findTrainingConfirmation(tx, input.confirmationId),
      tx.torqueWrenchProfile.findUnique({
        where: { id: input.torqueWrenchProfileId },
        include: profileEligibilityInclude
      }),
      this.confirmationRepository.findLease(tx, input.torqueWrenchProfileId)
    ]);
    if (!confirmation || confirmation.sessionId !== this.owner.sessionId || confirmation.clientDeviceId !== this.owner.clientDeviceId) {
      throw new ApiError(409, 'レンチ確認が必要です', undefined, 'CONFIRMATION_REQUIRED');
    }
    if (!profile) {
      throw new ApiError(404, '物理トルクレンチが見つかりません');
    }
    const condition = conditionFromTrainingVersion(session.programVersion);
    const eligibility = this.eligibilityPolicy.evaluate(
      condition,
      candidateFromProfile(profile, session.programVersion.capabilityGroup)
    );
    if (!eligibility.eligible) {
      throw new ApiError(409, 'レンチが訓練条件に適合しません', { reason: eligibility.reason }, eligibility.reason);
    }
    const mode = normalizeTorqueWrenchSettingVerificationMode(profile.model.settingVerificationMode);
    const latestSetting = profile.settingHistories[0] ?? null;
    if (usesRegisteredTorqueWrenchSetting(mode) && !latestSetting) {
      throw new ApiError(409, 'レンチ設定履歴がありません', undefined, 'SETTING_HISTORY_MISSING');
    }
    const expected: TorqueWrenchConfirmationExpectation = {
      sessionId: this.owner.sessionId,
      clientDeviceId: this.owner.clientDeviceId,
      torqueWrenchProfileId: input.torqueWrenchProfileId,
      settingHistoryId: usesRegisteredTorqueWrenchSetting(mode) ? latestSetting?.id ?? null : null,
      settingVerificationMode: mode,
      ownerKind: 'TRAINING',
      conditionFingerprint: session.conditionFingerprint
    };
    const decision = this.confirmationPolicy.evaluateLeaseAdoption({
      confirmation,
      lease,
      expected,
      now
    });
    if (decision.allowed) return;
    if (decision.reason === 'WRONG_PHYSICAL_WRENCH') {
      throw new ApiError(409, '確認したレンチと接続要求が一致しません', undefined, decision.reason);
    }
    if (decision.reason === 'CONFIRMATION_STALE') {
      throw new ApiError(409, '訓練条件またはレンチ設定が変更されています。レンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
    }
    throw new ApiError(409, 'この端末でトルクレンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
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
    repository = new TorqueWrenchUsageLeaseRepository(),
    private readonly confirmationPolicy = new TorqueWrenchConfirmationUsePolicy(),
    private readonly confirmationRepository = new TorqueWrenchConfirmationStateRepository(),
    private readonly eligibilityPolicy = new TorqueWrenchEligibilityPolicy()
  ) {
    this.coordinator = new TorqueWrenchUsageLeaseCoordinator(repository);
  }

  private validateAcquireInput(input: TrainingLeaseAcquireInput): void {
    if (input.takeover && input.physicalWrenchPresent !== true) {
      throw new ApiError(400, '現物のトルクレンチが手元にあることを確認してください');
    }
    if (input.takeover && !input.reason?.trim()) {
      throw new ApiError(400, '引継ぎ理由が必要です');
    }
  }

  /**
   * Acquire a training lease without opening a nested transaction.
   * Preparation uses this boundary so setting history, confirmation, request
   * claim and the physical-wrench owner row commit or roll back together.
   */
  async acquireInTransaction(
    tx: Prisma.TransactionClient,
    input: TrainingLeaseAcquireInput
  ) {
    this.validateAcquireInput(input);
    // Training writes lock the session before the profile. Take the same
    // session lock here before the coordinator acquires the profile lock so
    // the usage-lease FK write cannot deadlock with prepare/confirm/cancel.
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "TorqueTrainingSession" WHERE "id" = ${input.sessionId} FOR UPDATE
    `);
    const adapter = new TrainingTorqueWrenchLeaseAdapter(
      input.sessionId,
      input.clientDeviceId,
      this.confirmationPolicy,
      this.confirmationRepository,
      this.eligibilityPolicy
    );
    return this.coordinator.acquire(
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
    );
  }

  async acquire(input: TrainingLeaseAcquireInput) {
    return runTrainingTransaction((tx) => this.acquireInTransaction(tx, input));
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
    }) && current.adoptedConfirmationId === input.confirmationId;
  }
}
