import { randomUUID } from 'node:crypto';

import type {
  TorqueWrenchConnectionLeaseStatusDto,
  TorqueWrenchRejectionReason
} from '@raspi-system/shared-types';
import { Prisma, type AssemblyTemplateBolt } from '@prisma/client';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from '../assembly/assembly-transaction.js';
import { torqueConditionFingerprint, type TorqueCondition } from './torque-wrench-eligibility.policy.js';

export const TORQUE_CONNECTION_LEASE_TTL_MS = 8_000;
export const TORQUE_CONNECTION_HANDOFF_GRACE_MS = 1_000;

const leaseInclude = {
  ownerClientDevice: {
    select: { id: true, name: true, location: true }
  }
} satisfies Prisma.TorqueWrenchConnectionLeaseInclude;

export type ConnectionLeaseRow = Prisma.TorqueWrenchConnectionLeaseGetPayload<{
  include: typeof leaseInclude;
}>;

type AcquireInput = {
  torqueWrenchProfileId: string;
  clientDeviceId: string;
  sessionId: string;
  confirmationId: string;
  requestId: string;
  physicalWrenchPresent?: boolean;
  reason?: string | null;
};

type LeaseTokenInput = {
  torqueWrenchProfileId: string;
  clientDeviceId: string;
  sessionId: string;
  leaseId: string;
  generation: number;
};

export type AgentConnectionLeaseInput = {
  leaseId?: string | null;
  generation?: number | null;
  clientDeviceId: string;
  sessionId: string;
};

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + TORQUE_CONNECTION_LEASE_TTL_MS);
}

function releasedOrExpired(row: ConnectionLeaseRow, now: Date): boolean {
  return row.releasedAt !== null || row.expiresAt.getTime() <= now.getTime();
}

function ownerSnapshot(row: ConnectionLeaseRow, includePrivateIdentity: boolean) {
  return {
    clientDeviceName: row.ownerClientDevice.name,
    clientDeviceLocation: row.ownerClientDevice.location,
    ...(includePrivateIdentity
      ? {
          clientDeviceId: row.ownerClientDeviceId,
          sessionId: row.ownerSessionId
        }
      : {})
  };
}

export function serializeConnectionLease(
  torqueWrenchProfileId: string,
  row: ConnectionLeaseRow | null,
  requesterClientDeviceId: string,
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
  const isOwner = row.ownerClientDeviceId === requesterClientDeviceId;
  const waiting = isOwner && !released && !expired && row.connectAfter.getTime() > now.getTime();
  const state = released
    ? 'available'
    : expired
      ? 'expired'
      : waiting
        ? 'handoff_wait'
        : isOwner
          ? 'owned_by_self'
          : 'owned_by_other';

  return {
    torqueWrenchProfileId,
    state,
    owner: released ? null : ownerSnapshot(row, isOwner),
    expiresAt: released ? null : row.expiresAt.toISOString(),
    connectAfter: released ? null : row.connectAfter.toISOString(),
    ...(isOwner && !released && !expired
      ? { leaseId: row.leaseId, generation: row.generation }
      : {})
  };
}

export async function lockTorqueWrenchProfile(
  tx: Prisma.TransactionClient,
  torqueWrenchProfileId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "TorqueWrenchProfile"
    WHERE "id" = ${torqueWrenchProfileId}
    FOR UPDATE
  `);
  if (rows.length === 0) {
    throw new ApiError(404, '物理トルクレンチが見つかりません');
  }
}

async function lockAssemblySession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  clientDeviceId: string
): Promise<{ currentBoltId: string | null }> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "AssemblyWorkSession"
    WHERE "id" = ${sessionId}
    FOR UPDATE
  `);
  if (rows.length === 0) throw new ApiError(404, '作業セッションが見つかりません');
  const session = await tx.assemblyWorkSession.findUnique({
    where: { id: sessionId },
    select: { status: true, clientDeviceId: true, currentBoltId: true }
  });
  if (!session) throw new ApiError(404, '作業セッションが見つかりません');
  if (session.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'この作業はトルクレンチを接続できる状態ではありません', undefined, 'SESSION_STATE_CONFLICT');
  }
  if (session.clientDeviceId !== clientDeviceId) {
    throw new ApiError(403, 'この作業は別のクライアント端末に割り当てられています', undefined, 'SESSION_CLIENT_MISMATCH');
  }
  return { currentBoltId: session.currentBoltId };
}

function conditionFromBolt(bolt: AssemblyTemplateBolt): TorqueCondition {
  return {
    templateBoltId: bolt.id,
    nominalDiameter: bolt.nominalDiameter,
    boltLengthMm: bolt.boltLengthMm,
    material: bolt.material,
    strengthClass: bolt.strengthClass,
    capabilityGroupId: bolt.capabilityGroupId,
    lowerLimit: bolt.lowerLimit,
    nominalTorque: bolt.nominalTorque,
    upperLimit: bolt.upperLimit,
    unit: bolt.unit
  };
}

async function validateConfirmation(
  tx: Prisma.TransactionClient,
  input: Pick<AcquireInput, 'confirmationId' | 'sessionId' | 'torqueWrenchProfileId' | 'clientDeviceId'> & {
    currentBoltId: string | null;
  }
): Promise<void> {
  const confirmation = await tx.assemblyTorqueWrenchConfirmation.findUnique({
    where: { id: input.confirmationId },
    select: {
      sessionId: true,
      torqueWrenchProfileId: true,
      settingHistoryId: true,
      conditionFingerprint: true,
      clientDeviceId: true
    }
  });
  if (!confirmation || confirmation.sessionId !== input.sessionId) {
    throw new ApiError(409, '現在の作業に有効なレンチ確認がありません', undefined, 'CONFIRMATION_REQUIRED');
  }
  if (confirmation.torqueWrenchProfileId !== input.torqueWrenchProfileId) {
    throw new ApiError(409, '確認したレンチと接続要求が一致しません', undefined, 'WRONG_PHYSICAL_WRENCH');
  }
  if (confirmation.clientDeviceId !== input.clientDeviceId) {
    throw new ApiError(409, 'この端末でトルクレンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
  }
  if (!input.currentBoltId) {
    throw new ApiError(409, '現在の締付箇所がありません', undefined, 'CONFIRMATION_REQUIRED');
  }
  const bolt = await tx.assemblyTemplateBolt.findUnique({ where: { id: input.currentBoltId } });
  if (
    !bolt ||
    confirmation.conditionFingerprint !== torqueConditionFingerprint(conditionFromBolt(bolt))
  ) {
    throw new ApiError(409, '現在の締付条件に対してトルクレンチを再確認してください', undefined, 'CONFIRMATION_REQUIRED');
  }
  const latestSetting = await tx.torqueWrenchSettingHistory.findFirst({
    where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true }
  });
  if (!latestSetting || confirmation.settingHistoryId !== latestSetting.id) {
    throw new ApiError(409, 'レンチ設定が更新されています。表示設定を再確認してください', undefined, 'CONFIRMATION_REQUIRED');
  }
}

async function loadClient(
  tx: Prisma.TransactionClient,
  clientDeviceId: string
): Promise<{ id: string; name: string; location: string | null }> {
  const client = await tx.clientDevice.findUnique({
    where: { id: clientDeviceId },
    select: { id: true, name: true, location: true }
  });
  if (!client) throw new ApiError(401, 'クライアント端末が見つかりません', undefined, 'INVALID_CLIENT_KEY');
  return client;
}

async function appendHistory(
  tx: Prisma.TransactionClient,
  input: {
    profileId: string;
    leaseId: string;
    generation: number;
    action: string;
    ownerClientDeviceId: string;
    ownerClientDeviceName: string;
    ownerSessionId: string;
    previous?: ConnectionLeaseRow | null;
    reason?: string | null;
  }
): Promise<void> {
  await tx.torqueWrenchConnectionLeaseHistory.create({
    data: {
      torqueWrenchProfileId: input.profileId,
      leaseId: input.leaseId,
      generation: input.generation,
      action: input.action,
      ownerClientDeviceId: input.ownerClientDeviceId,
      ownerClientDeviceName: input.ownerClientDeviceName,
      ownerSessionId: input.ownerSessionId,
      previousClientDeviceId: input.previous?.ownerClientDeviceId ?? null,
      previousClientDeviceName: input.previous?.ownerClientDevice.name ?? null,
      previousSessionId: input.previous?.ownerSessionId ?? null,
      reason: input.reason?.trim().slice(0, 500) || null
    }
  });
}

function assertLeaseToken(row: ConnectionLeaseRow | null, input: LeaseTokenInput): ConnectionLeaseRow {
  if (!row || row.leaseId !== input.leaseId || row.generation !== input.generation) {
    throw new ApiError(409, 'トルクレンチ接続権は新しい世代へ移行しました', undefined, 'TORQUE_WRENCH_LEASE_FENCED');
  }
  if (row.ownerClientDeviceId !== input.clientDeviceId) {
    throw new ApiError(409, 'この端末はトルクレンチ接続権を所有していません', undefined, 'TORQUE_WRENCH_LEASE_OWNER_MISMATCH');
  }
  if (row.ownerSessionId !== input.sessionId) {
    throw new ApiError(409, 'トルクレンチ接続権は別の作業セッションに割り当てられています', undefined, 'TORQUE_WRENCH_LEASE_SESSION_MISMATCH');
  }
  return row;
}

export class TorqueWrenchConnectionLeaseService {
  async getStatus(torqueWrenchProfileId: string, clientDeviceId: string) {
    const profile = await prisma.torqueWrenchProfile.findUnique({
      where: { id: torqueWrenchProfileId },
      select: { id: true }
    });
    if (!profile) throw new ApiError(404, '物理トルクレンチが見つかりません');
    const row = await prisma.torqueWrenchConnectionLease.findUnique({
      where: { torqueWrenchProfileId },
      include: leaseInclude
    });
    return serializeConnectionLease(torqueWrenchProfileId, row, clientDeviceId);
  }

  async acquire(input: AcquireInput) {
    return this.acquireInternal(input, false);
  }

  async takeover(input: AcquireInput) {
    if (input.physicalWrenchPresent !== true) {
      throw new ApiError(400, '現物のトルクレンチが手元にあることを確認してください');
    }
    const reason = input.reason?.trim();
    if (!reason) throw new ApiError(400, '引継ぎ理由が必要です');
    return this.acquireInternal({ ...input, reason }, true);
  }

  private async acquireInternal(input: AcquireInput, takeover: boolean) {
    return runAssemblyTransaction(async (tx) => {
      await lockTorqueWrenchProfile(tx, input.torqueWrenchProfileId);
      const session = await lockAssemblySession(tx, input.sessionId, input.clientDeviceId);
      await validateConfirmation(tx, { ...input, currentBoltId: session.currentBoltId });
      const client = await loadClient(tx, input.clientDeviceId);
      const now = new Date();
      const existing = await tx.torqueWrenchConnectionLease.findUnique({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        include: leaseInclude
      });

      if (existing && !releasedOrExpired(existing, now)) {
        if (
          existing.ownerClientDeviceId === input.clientDeviceId &&
          existing.ownerSessionId === input.sessionId
        ) {
          const renewed = await tx.torqueWrenchConnectionLease.update({
            where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
            data: { requestId: input.requestId, renewedAt: now, expiresAt: expiryFrom(now) },
            include: leaseInclude
          });
          return serializeConnectionLease(input.torqueWrenchProfileId, renewed, input.clientDeviceId, now);
        }
        if (!takeover) {
          throw new ApiError(
            409,
            'このトルクレンチは別の端末で使用中です',
            { lease: serializeConnectionLease(input.torqueWrenchProfileId, existing, input.clientDeviceId, now) },
            'TORQUE_WRENCH_LEASE_HELD'
          );
        }
      }

      const leaseId = randomUUID();
      const generation = (existing?.generation ?? 0) + 1;
      const connectAfter = takeover && existing && existing.expiresAt.getTime() > now.getTime()
        ? new Date(existing.expiresAt.getTime() + TORQUE_CONNECTION_HANDOFF_GRACE_MS)
        : now;
      const action = takeover && existing && !releasedOrExpired(existing, now)
        ? 'TAKEN_OVER'
        : existing && existing.expiresAt.getTime() <= now.getTime() && existing.releasedAt === null
          ? 'EXPIRED_ACQUIRED'
          : 'ACQUIRED';
      const row = await tx.torqueWrenchConnectionLease.upsert({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        create: {
          torqueWrenchProfileId: input.torqueWrenchProfileId,
          leaseId,
          generation,
          requestId: input.requestId,
          ownerClientDeviceId: input.clientDeviceId,
          ownerSessionId: input.sessionId,
          acquiredAt: now,
          renewedAt: now,
          expiresAt: expiryFrom(now),
          connectAfter
        },
        update: {
          leaseId,
          generation,
          requestId: input.requestId,
          ownerClientDeviceId: input.clientDeviceId,
          ownerSessionId: input.sessionId,
          acquiredAt: now,
          renewedAt: now,
          expiresAt: expiryFrom(now),
          connectAfter,
          releasedAt: null,
          releaseReason: null
        },
        include: leaseInclude
      });
      await appendHistory(tx, {
        profileId: input.torqueWrenchProfileId,
        leaseId,
        generation,
        action,
        ownerClientDeviceId: client.id,
        ownerClientDeviceName: client.name,
        ownerSessionId: input.sessionId,
        previous: existing,
        reason: input.reason
      });
      return serializeConnectionLease(input.torqueWrenchProfileId, row, input.clientDeviceId, now);
    });
  }

  async renew(input: LeaseTokenInput) {
    return runAssemblyTransaction(async (tx) => {
      await lockTorqueWrenchProfile(tx, input.torqueWrenchProfileId);
      const now = new Date();
      const existing = await tx.torqueWrenchConnectionLease.findUnique({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        include: leaseInclude
      });
      const row = assertLeaseToken(existing, input);
      if (row.releasedAt || row.expiresAt.getTime() <= now.getTime()) {
        throw new ApiError(409, 'トルクレンチ接続権の有効期限が切れました', undefined, 'TORQUE_WRENCH_LEASE_EXPIRED');
      }
      const renewed = await tx.torqueWrenchConnectionLease.update({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        data: { renewedAt: now, expiresAt: expiryFrom(now) },
        include: leaseInclude
      });
      return serializeConnectionLease(input.torqueWrenchProfileId, renewed, input.clientDeviceId, now);
    });
  }

  async release(input: LeaseTokenInput & { reason?: string | null }) {
    return runAssemblyTransaction(async (tx) => {
      await lockTorqueWrenchProfile(tx, input.torqueWrenchProfileId);
      const now = new Date();
      const existing = await tx.torqueWrenchConnectionLease.findUnique({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        include: leaseInclude
      });
      const row = assertLeaseToken(existing, input);
      if (row.releasedAt) {
        return serializeConnectionLease(input.torqueWrenchProfileId, row, input.clientDeviceId, now);
      }
      const released = await tx.torqueWrenchConnectionLease.update({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        data: {
          releasedAt: now,
          releaseReason: input.reason?.trim().slice(0, 500) || 'CLIENT_RELEASE'
        },
        include: leaseInclude
      });
      await appendHistory(tx, {
        profileId: input.torqueWrenchProfileId,
        leaseId: row.leaseId,
        generation: row.generation,
        action: 'RELEASED',
        ownerClientDeviceId: row.ownerClientDeviceId,
        ownerClientDeviceName: row.ownerClientDevice.name,
        ownerSessionId: row.ownerSessionId,
        reason: input.reason ?? 'CLIENT_RELEASE'
      });
      return serializeConnectionLease(input.torqueWrenchProfileId, released, input.clientDeviceId, now);
    });
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
  input: AgentConnectionLeaseInput
): Promise<TorqueWrenchRejectionReason | null> {
  const hasLeaseId = typeof input.leaseId === 'string' && input.leaseId.length > 0;
  const hasGeneration = Number.isInteger(input.generation) && Number(input.generation) > 0;
  if (!hasLeaseId || !hasGeneration) {
    return profile.connectionLeaseEnforcedAt ? 'CONNECTION_LEASE_REQUIRED' : null;
  }
  const lease = await tx.torqueWrenchConnectionLease.findUnique({
    where: { torqueWrenchProfileId: profile.id },
    select: {
      leaseId: true,
      generation: true,
      ownerClientDeviceId: true,
      ownerSessionId: true
    }
  });
  if (!lease || lease.leaseId !== input.leaseId || lease.generation !== input.generation) {
    return 'CONNECTION_LEASE_FENCED';
  }
  if (lease.ownerClientDeviceId !== input.clientDeviceId) {
    return 'CONNECTION_LEASE_OWNER_MISMATCH';
  }
  if (lease.ownerSessionId !== input.sessionId) {
    return 'CONNECTION_LEASE_SESSION_MISMATCH';
  }
  return null;
}
