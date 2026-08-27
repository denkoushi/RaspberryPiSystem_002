import type {
  TorqueWrenchConnectionLeaseStatusDto,
  TorqueWrenchRejectionReason
} from '@raspi-system/shared-types';
import { Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from '../assembly/assembly-transaction.js';
import { TorqueWrenchConfirmationStateRepository } from './torque-wrench-confirmation-state.repository.js';
import {
  TorqueWrenchConfirmationUsePolicy,
  type TorqueWrenchConfirmationExpectation
} from './torque-wrench-confirmation-use.policy.js';
import { TorqueWrenchEligibilityPolicy } from './torque-wrench-eligibility.policy.js';
import {
  candidateFromProfile,
  capabilityGroupEligibilityInclude,
  conditionFromBolt,
  profileEligibilityInclude
} from './torque-wrench-use-context.js';
import {
  normalizeTorqueWrenchSettingVerificationMode,
  usesRegisteredTorqueWrenchSetting
} from './torque-wrench-setting-mode.policy.js';
import {
  serializeUsageLeaseStatus,
  type UsageLeaseOwnerIdentity,
  TORQUE_USAGE_LEASE_HANDOFF_GRACE_MS,
  TORQUE_USAGE_LEASE_TTL_MS
} from './torque-wrench-usage-lease.policy.js';
import {
  TorqueWrenchUsageLeaseCoordinator,
  type UsageLeaseAcquireActionContext,
  type UsageLeaseAcquireInput,
  type UsageLeaseOwnerAdapter,
  type UsageLeaseReleaseResponse
} from './torque-wrench-usage-lease.coordinator.js';
import {
  TorqueWrenchUsageLeaseRepository,
  type TorqueWrenchUsageLeaseRow
} from './torque-wrench-usage-lease.repository.js';
import { lockTorqueWrenchProfile } from './torque-wrench-lock.repository.js';

export const TORQUE_CONNECTION_LEASE_TTL_MS = TORQUE_USAGE_LEASE_TTL_MS;
export const TORQUE_CONNECTION_HANDOFF_GRACE_MS = TORQUE_USAGE_LEASE_HANDOFF_GRACE_MS;

export type ConnectionLeaseRow = TorqueWrenchUsageLeaseRow;

type AcquireInput = UsageLeaseAcquireInput & {
  torqueWrenchProfileId: string;
  clientDeviceId: string;
  sessionId: string;
};

type LeaseTokenInput = {
  torqueWrenchProfileId: string;
  clientDeviceId: string;
  sessionId: string;
  leaseId: string;
  generation: number;
  reason?: string | null;
};

export type AgentConnectionLeaseInput = {
  leaseId?: string | null;
  generation?: number | null;
  confirmationId: string;
  clientDeviceId: string;
  sessionId: string;
};

export function serializeConnectionLease(
  torqueWrenchProfileId: string,
  row: ConnectionLeaseRow | null,
  requesterClientDeviceId: string,
  now = new Date(),
  requesterSessionId?: string
): TorqueWrenchConnectionLeaseStatusDto {
  return serializeUsageLeaseStatus(
    torqueWrenchProfileId,
    row,
    {
      ownerKind: 'ASSEMBLY',
      clientDeviceId: requesterClientDeviceId,
      ...(requesterSessionId ? { sessionId: requesterSessionId } : {})
    },
    now
  );
}

async function lockAssemblySession(
  tx: Prisma.TransactionClient,
  sessionId: string
): Promise<{ currentBoltId: string | null }> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "AssemblyWorkSession"
    WHERE "id" = ${sessionId}
    FOR UPDATE
  `);
  if (rows.length === 0) throw new ApiError(404, '作業セッションが見つかりません');
  const session = await tx.assemblyWorkSession.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      currentBoltId: true,
      workUnit: { select: { invalidatedAt: true } }
    }
  });
  if (!session) throw new ApiError(404, '作業セッションが見つかりません');
  if (session.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'この作業はトルクレンチを接続できる状態ではありません', undefined, 'SESSION_STATE_CONFLICT');
  }
  if (session.workUnit?.invalidatedAt) {
    throw new ApiError(409, '削除済みの作業用IDにはトルクレンチを接続できません', undefined, 'ASSEMBLY_WORK_UNIT_INVALIDATED');
  }
  return { currentBoltId: session.currentBoltId };
}

async function validateConfirmation(
  tx: Prisma.TransactionClient,
  input: Pick<AcquireInput, 'confirmationId' | 'sessionId' | 'torqueWrenchProfileId' | 'clientDeviceId'> & {
    currentBoltId: string | null;
    now: Date;
  },
  confirmationPolicy: TorqueWrenchConfirmationUsePolicy,
  confirmationRepository: TorqueWrenchConfirmationStateRepository,
  eligibilityPolicy: TorqueWrenchEligibilityPolicy
): Promise<void> {
  const confirmation = await confirmationRepository.findConfirmation(tx, input.confirmationId);
  if (!confirmation) {
    throw new ApiError(409, '現在の作業に有効なレンチ確認がありません', undefined, 'CONFIRMATION_REQUIRED');
  }
  if (!input.currentBoltId) {
    throw new ApiError(409, '現在の締付箇所がありません', undefined, 'CONFIRMATION_REQUIRED');
  }
  const bolt = await tx.assemblyTemplateBolt.findUnique({ where: { id: input.currentBoltId } });
  if (!bolt || !bolt.capabilityGroupId) {
    throw new ApiError(409, '現在の締付条件に対してトルクレンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
  }
  const [profile, capabilityGroup, lease] = await Promise.all([
    tx.torqueWrenchProfile.findUnique({
      where: { id: input.torqueWrenchProfileId },
      include: profileEligibilityInclude
    }),
    tx.torqueWrenchCapabilityGroup.findUnique({
      where: { id: bolt.capabilityGroupId },
      include: capabilityGroupEligibilityInclude
    }),
    confirmationRepository.findLease(tx, input.torqueWrenchProfileId)
  ]);
  if (!profile) {
    throw new ApiError(404, '物理トルクレンチが見つかりません');
  }
  if (!capabilityGroup) {
    throw new ApiError(409, '適合グループが見つかりません', undefined, 'WRONG_CAPABILITY_GROUP');
  }
  const eligibility = eligibilityPolicy.evaluate(
    conditionFromBolt(bolt),
    candidateFromProfile(profile, capabilityGroup)
  );
  if (!eligibility.eligible) {
    throw new ApiError(
      409,
      'このトルクレンチは現在の締付条件に適合しません',
      { reason: eligibility.reason },
      eligibility.reason
    );
  }
  const mode = normalizeTorqueWrenchSettingVerificationMode(profile.model.settingVerificationMode);
  const latestSetting = profile.settingHistories[0] ?? null;
  if (usesRegisteredTorqueWrenchSetting(mode) && !latestSetting) {
    throw new ApiError(409, '現在設定が登録されていません', undefined, 'SETTING_HISTORY_MISSING');
  }
  const expected: TorqueWrenchConfirmationExpectation = {
    sessionId: input.sessionId,
    clientDeviceId: input.clientDeviceId,
    torqueWrenchProfileId: input.torqueWrenchProfileId,
    settingHistoryId: usesRegisteredTorqueWrenchSetting(mode) ? latestSetting?.id ?? null : null,
    settingVerificationMode: mode,
    ownerKind: 'ASSEMBLY',
    conditionFingerprint: eligibility.conditionFingerprint
  };
  const decision = confirmationPolicy.evaluateLeaseAdoption({
    confirmation,
    lease,
    expected,
    now: input.now
  });
  if (decision.allowed) return;
  if (decision.reason === 'WRONG_PHYSICAL_WRENCH') {
    throw new ApiError(409, '確認したレンチと接続要求が一致しません', undefined, decision.reason);
  }
  if (decision.reason === 'CONFIRMATION_STALE') {
    throw new ApiError(
      409,
      '締付条件またはレンチ設定が変更されています。表示設定を再確認してください',
      undefined,
      'CONFIRMATION_REQUIRED'
    );
  }
  throw new ApiError(409, 'この端末でトルクレンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
}

class AssemblyTorqueWrenchLeaseAdapter implements UsageLeaseOwnerAdapter {
  readonly owner: UsageLeaseOwnerIdentity;
  readonly releaseAction = 'RELEASED';
  readonly defaultReleaseReason = 'CLIENT_RELEASE';

  constructor(
    input: Pick<AcquireInput, 'clientDeviceId' | 'sessionId'>,
    private readonly confirmationPolicy: TorqueWrenchConfirmationUsePolicy,
    private readonly confirmationRepository: TorqueWrenchConfirmationStateRepository,
    private readonly eligibilityPolicy: TorqueWrenchEligibilityPolicy
  ) {
    this.owner = {
      ownerKind: 'ASSEMBLY',
      clientDeviceId: input.clientDeviceId,
      sessionId: input.sessionId
    };
  }

  async validateAcquire(
    tx: Prisma.TransactionClient,
    input: UsageLeaseAcquireInput & { clientDeviceId?: string; sessionId?: string },
    now: Date
  ): Promise<void> {
    const session = await lockAssemblySession(tx, this.owner.sessionId);
    await validateConfirmation(
      tx,
      {
        confirmationId: input.confirmationId,
        sessionId: this.owner.sessionId,
        torqueWrenchProfileId: input.torqueWrenchProfileId,
        clientDeviceId: this.owner.clientDeviceId,
        currentBoltId: session.currentBoltId,
        now
      },
      this.confirmationPolicy,
      this.confirmationRepository,
      this.eligibilityPolicy
    );
  }

  acquireAction(context: UsageLeaseAcquireActionContext): string | null {
    if (context.takeover && context.previousActive) return 'TAKEN_OVER';
    if (
      context.previous
      && context.previous.releasedAt === null
      && context.previous.expiresAt.getTime() <= context.now.getTime()
    ) {
      return 'EXPIRED_ACQUIRED';
    }
    if (context.sameOwner && context.previous?.releasedAt === null) {
      return context.confirmationChanged ? 'CONFIRMATION_ADOPTED' : null;
    }
    return 'ACQUIRED';
  }
}

export class TorqueWrenchConnectionLeaseService {
  private readonly coordinator: TorqueWrenchUsageLeaseCoordinator;

  constructor(
    private readonly confirmationPolicy = new TorqueWrenchConfirmationUsePolicy(),
    private readonly confirmationRepository = new TorqueWrenchConfirmationStateRepository(),
    private readonly eligibilityPolicy = new TorqueWrenchEligibilityPolicy(),
    repository = new TorqueWrenchUsageLeaseRepository()
  ) {
    this.coordinator = new TorqueWrenchUsageLeaseCoordinator(repository);
  }

  async getStatus(torqueWrenchProfileId: string, clientDeviceId: string, sessionId?: string) {
    const profile = await prisma.torqueWrenchProfile.findUnique({
      where: { id: torqueWrenchProfileId },
      select: { id: true }
    });
    if (!profile) throw new ApiError(404, '物理トルクレンチが見つかりません');
    return this.coordinator.getStatus(
      prisma,
      torqueWrenchProfileId,
      {
        ownerKind: 'ASSEMBLY',
        clientDeviceId,
        ...(sessionId ? { sessionId } : {})
      }
    );
  }

  async acquire(input: AcquireInput) {
    return runAssemblyTransaction((tx) => this.coordinator.acquire(
      tx,
      { ...input, takeover: false },
      new AssemblyTorqueWrenchLeaseAdapter(
        input,
        this.confirmationPolicy,
        this.confirmationRepository,
        this.eligibilityPolicy
      )
    ));
  }

  async takeover(input: AcquireInput) {
    if (input.physicalWrenchPresent !== true) {
      throw new ApiError(400, '現物のトルクレンチが手元にあることを確認してください');
    }
    const reason = input.reason?.trim();
    if (!reason) throw new ApiError(400, '引継ぎ理由が必要です');
    return runAssemblyTransaction((tx) => this.coordinator.acquire(
      tx,
      { ...input, reason, takeover: true },
      new AssemblyTorqueWrenchLeaseAdapter(
        input,
        this.confirmationPolicy,
        this.confirmationRepository,
        this.eligibilityPolicy
      )
    ));
  }

  async renew(input: LeaseTokenInput) {
    return runAssemblyTransaction((tx) => this.coordinator.renew(tx, {
      torqueWrenchProfileId: input.torqueWrenchProfileId,
      leaseId: input.leaseId,
      generation: input.generation,
      owner: {
        ownerKind: 'ASSEMBLY',
        clientDeviceId: input.clientDeviceId,
        sessionId: input.sessionId
      }
    }));
  }

  async release(input: LeaseTokenInput & { reason?: string | null }): Promise<UsageLeaseReleaseResponse> {
    return runAssemblyTransaction((tx) => this.coordinator.release(
      tx,
      {
        torqueWrenchProfileId: input.torqueWrenchProfileId,
        leaseId: input.leaseId,
        generation: input.generation,
        owner: {
          ownerKind: 'ASSEMBLY',
          clientDeviceId: input.clientDeviceId,
          sessionId: input.sessionId
        },
        reason: input.reason
      },
      'CLIENT_RELEASE',
      'RELEASED'
    ));
  }

  async enableEnforcement(input: {
    torqueWrenchProfileId: string;
    reason: string;
    actorUserId: string;
    actorUsername: string;
  }) {
    if (!env.TORQUE_CONNECTION_LEASE_ACTIVATION_ALLOWED) {
      throw new ApiError(
        409,
        'トルクレンチ接続リースの有効化ゲートが閉じています',
        undefined,
        'TORQUE_CONNECTION_LEASE_ACTIVATION_DISABLED'
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new ApiError(400, '有効化理由が必要です');
    return runAssemblyTransaction(async (tx) => {
      await lockTorqueWrenchProfile(tx, input.torqueWrenchProfileId);
      const profile = await tx.torqueWrenchProfile.findUnique({
        where: { id: input.torqueWrenchProfileId }
      });
      if (!profile) throw new ApiError(404, '物理トルクレンチが見つかりません');
      if (profile.connectionLeaseEnforcedAt) return profile;
      return tx.torqueWrenchProfile.update({
        where: { id: input.torqueWrenchProfileId },
        data: {
          connectionLeaseEnforcedAt: new Date(),
          connectionLeaseEnforcementReason: reason.slice(0, 500),
          connectionLeaseEnforcedByUserId: input.actorUserId,
          connectionLeaseEnforcedByUsername: input.actorUsername
        }
      });
    });
  }
}

export async function evaluateAgentConnectionLease(
  tx: Prisma.TransactionClient,
  profile: { id: string; connectionLeaseEnforcedAt: Date | null },
  input: AgentConnectionLeaseInput,
  confirmationPolicy = new TorqueWrenchConfirmationUsePolicy(),
  confirmationRepository = new TorqueWrenchConfirmationStateRepository()
): Promise<TorqueWrenchRejectionReason | null> {
  const lease = await confirmationRepository.findLease(tx, profile.id);
  const decision = confirmationPolicy.evaluateAgentLease({
    lease,
    leaseEnforced: profile.connectionLeaseEnforcedAt !== null,
    leaseId: input.leaseId,
    generation: input.generation,
    confirmationId: input.confirmationId,
    clientDeviceId: input.clientDeviceId,
    sessionId: input.sessionId
  });
  return decision.allowed ? null : decision.reason;
}
