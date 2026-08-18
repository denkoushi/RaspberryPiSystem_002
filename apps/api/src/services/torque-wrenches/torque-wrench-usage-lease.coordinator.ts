import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import {
  isSameUsageLeaseOwner,
  isSameUsageLeaseToken,
  isUsageLeaseActive,
  nextUsageLeaseConnectAfter,
  ownerFields,
  serializeUsageLeaseStatus,
  TORQUE_USAGE_LEASE_TTL_MS,
  type UsageLeaseOwnerIdentity,
  type UsageLeaseToken,
  type UsageLeaseViewer
} from './torque-wrench-usage-lease.policy.js';
import {
  TorqueWrenchUsageLeaseRepository,
  type UsageLeaseDb,
  type TorqueWrenchUsageLeaseRow
} from './torque-wrench-usage-lease.repository.js';

export type UsageLeaseAcquireInput = {
  torqueWrenchProfileId: string;
  confirmationId: string;
  requestId: string;
  takeover?: boolean;
  physicalWrenchPresent?: boolean;
  reason?: string | null;
};

export type UsageLeaseTokenInput = UsageLeaseToken & {
  owner: UsageLeaseOwnerIdentity;
  reason?: string | null;
};

export type UsageLeaseAcquireActionContext = {
  now: Date;
  sameOwner: boolean;
  takeover: boolean;
  previous: TorqueWrenchUsageLeaseRow | null;
  previousActive: boolean;
  confirmationChanged: boolean;
};

export type UsageLeaseOwnerAdapter = {
  owner: UsageLeaseOwnerIdentity;
  validateAcquire(
    tx: Prisma.TransactionClient,
    input: UsageLeaseAcquireInput,
    now: Date
  ): Promise<void>;
  acquireAction(context: UsageLeaseAcquireActionContext): string | null;
  releaseAction: string;
  defaultReleaseReason: string;
};

export type UsageLeaseReleaseResult = 'released' | 'already_absent' | 'stale_noop';

export type UsageLeaseReleaseResponse = {
  result: UsageLeaseReleaseResult;
  status: ReturnType<typeof serializeUsageLeaseStatus>;
};

export class TorqueWrenchUsageLeaseCoordinator {
  constructor(
    private readonly repository = new TorqueWrenchUsageLeaseRepository()
  ) {}

  async lockProfile(
    tx: Prisma.TransactionClient,
    torqueWrenchProfileId: string
  ): Promise<void> {
    await this.repository.lockProfile(tx, torqueWrenchProfileId);
  }

  async getStatus(
    db: UsageLeaseDb,
    torqueWrenchProfileId: string,
    viewer: UsageLeaseViewer,
    now = new Date()
  ) {
    const row = await this.repository.find(db, torqueWrenchProfileId);
    return serializeUsageLeaseStatus(torqueWrenchProfileId, row, viewer, now);
  }

  async acquire(
    tx: Prisma.TransactionClient,
    input: UsageLeaseAcquireInput,
    adapter: UsageLeaseOwnerAdapter
  ) {
    await this.repository.lockProfile(tx, input.torqueWrenchProfileId);
    const now = new Date();
    const existing = await this.repository.find(tx, input.torqueWrenchProfileId);
    await adapter.validateAcquire(tx, input, now);

    const active = existing !== null && isUsageLeaseActive(existing, now);
    const sameOwner = existing !== null && isSameUsageLeaseOwner(existing, adapter.owner);
    const takeover = input.takeover === true;

    if (active && sameOwner && !takeover) {
      // A retry of the same operator action is idempotent. In particular, do
      // not move a future handoff deadline backwards to `now`.
      if (existing.requestId === input.requestId) {
        return serializeUsageLeaseStatus(
          input.torqueWrenchProfileId,
          existing,
          adapter.owner,
          now
        );
      }

      const renewed = await tx.torqueWrenchUsageLease.update({
        where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
        data: {
          requestId: input.requestId,
          adoptedConfirmationId: input.confirmationId,
          renewedAt: now,
          expiresAt: expiryFrom(now)
        },
        include: {
          ownerClientDevice: {
            select: { id: true, name: true, location: true }
          }
        }
      });
      const client = await this.repository.findClient(tx, adapter.owner.clientDeviceId);
      if (!client) throw invalidClientError();
      const action = adapter.acquireAction({
        now,
        sameOwner: true,
        takeover,
        previous: existing,
        previousActive: true,
        confirmationChanged: existing.adoptedConfirmationId !== input.confirmationId
      });
      if (action) {
        await this.repository.appendHistory(tx, {
          profileId: input.torqueWrenchProfileId,
          leaseId: existing.leaseId,
          generation: existing.generation,
          owner: adapter.owner,
          ownerClientDeviceName: client.name,
          action,
          adoptedConfirmationId: input.confirmationId,
          reason: input.reason
        });
      }
      return serializeUsageLeaseStatus(
        input.torqueWrenchProfileId,
        renewed,
        adapter.owner,
        now
      );
    }

    if (active && !sameOwner && !takeover) {
      throw new ApiError(
        409,
        'このトルクレンチは別の作業または端末で使用中です',
        {
          lease: serializeUsageLeaseStatus(
            input.torqueWrenchProfileId,
            existing,
            adapter.owner,
            now
          )
        },
        'TORQUE_WRENCH_LEASE_HELD'
      );
    }

    const client = await this.repository.findClient(tx, adapter.owner.clientDeviceId);
    if (!client) throw invalidClientError();

    const generation = (existing?.generation ?? 0) + 1;
    const leaseId = randomUUID();
    const connectAfter = nextUsageLeaseConnectAfter(existing, now, {
      sameOwner,
      takeover,
      previousExpiresAt: existing?.expiresAt
    });
    const action = adapter.acquireAction({
      now,
      sameOwner,
      takeover,
      previous: existing,
      previousActive: active,
      confirmationChanged: existing?.adoptedConfirmationId !== input.confirmationId
    });
    const owner = ownerFields(adapter.owner);
    const row = await tx.torqueWrenchUsageLease.upsert({
      where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
      create: {
        torqueWrenchProfileId: input.torqueWrenchProfileId,
        leaseId,
        generation,
        requestId: input.requestId,
        ...owner,
        adoptedConfirmationId: input.confirmationId,
        acquiredAt: now,
        renewedAt: now,
        expiresAt: expiryFrom(now),
        connectAfter
      },
      update: {
        leaseId,
        generation,
        requestId: input.requestId,
        ...owner,
        adoptedConfirmationId: input.confirmationId,
        acquiredAt: now,
        renewedAt: now,
        expiresAt: expiryFrom(now),
        connectAfter,
        releasedAt: null,
        releaseReason: null
      },
      include: {
        ownerClientDevice: {
          select: { id: true, name: true, location: true }
        }
      }
    });
    if (action) {
      await this.repository.appendHistory(tx, {
        profileId: input.torqueWrenchProfileId,
        leaseId,
        generation,
        owner: adapter.owner,
        ownerClientDeviceName: client.name,
        action,
        adoptedConfirmationId: input.confirmationId,
        reason: input.reason
      });
    }
    return serializeUsageLeaseStatus(
      input.torqueWrenchProfileId,
      row,
      adapter.owner,
      now
    );
  }

  async renew(
    tx: Prisma.TransactionClient,
    input: UsageLeaseTokenInput
  ) {
    await this.repository.lockProfile(tx, input.torqueWrenchProfileId);
    const now = new Date();
    const existing = await this.repository.find(tx, input.torqueWrenchProfileId);
    assertCurrentToken(existing, input);
    assertCurrentOwner(existing, input.owner);
    if (!isUsageLeaseActive(existing, now)) {
      throw new ApiError(
        409,
        'トルクレンチ接続権の有効期限が切れました',
        undefined,
        'TORQUE_WRENCH_LEASE_EXPIRED'
      );
    }
    const renewed = await tx.torqueWrenchUsageLease.update({
      where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
      data: { renewedAt: now, expiresAt: expiryFrom(now) },
      include: {
        ownerClientDevice: {
          select: { id: true, name: true, location: true }
        }
      }
    });
    return serializeUsageLeaseStatus(
      input.torqueWrenchProfileId,
      renewed,
      input.owner,
      now
    );
  }

  async release(
    tx: Prisma.TransactionClient,
    input: UsageLeaseTokenInput,
    defaultReason: string,
    action: string
  ): Promise<UsageLeaseReleaseResponse> {
    await this.repository.lockProfile(tx, input.torqueWrenchProfileId);
    const now = new Date();
    const existing = await this.repository.find(tx, input.torqueWrenchProfileId);
    if (!existing) {
      return {
        result: 'already_absent',
        status: serializeUsageLeaseStatus(
          input.torqueWrenchProfileId,
          null,
          input.owner,
          now
        )
      };
    }

    const exact = isSameUsageLeaseToken(existing, input)
      && isSameUsageLeaseOwner(existing, input.owner);
    if (!exact) {
      // Delayed browser/agent cleanup must never touch a successor's lease.
      // Returning success lets navigation complete while the current owner
      // remains untouched and its public identity is still redacted here.
      return {
        result: 'stale_noop',
        status: serializeUsageLeaseStatus(
          input.torqueWrenchProfileId,
          existing,
          input.owner,
          now
        )
      };
    }
    if (existing.releasedAt !== null) {
      return {
        result: 'already_absent',
        status: serializeUsageLeaseStatus(
          input.torqueWrenchProfileId,
          existing,
          input.owner,
          now
        )
      };
    }

    const reason = input.reason?.trim() || defaultReason;
    const released = await tx.torqueWrenchUsageLease.update({
      where: { torqueWrenchProfileId: input.torqueWrenchProfileId },
      data: { releasedAt: now, releaseReason: reason.slice(0, 500) },
      include: {
        ownerClientDevice: {
          select: { id: true, name: true, location: true }
        }
      }
    });
    await this.repository.appendHistory(tx, {
      profileId: input.torqueWrenchProfileId,
      leaseId: existing.leaseId,
      generation: existing.generation,
      owner: input.owner,
      ownerClientDeviceName: existing.ownerClientDevice.name,
      action,
      adoptedConfirmationId: existing.adoptedConfirmationId,
      reason
    });
    return {
      result: 'released',
      status: serializeUsageLeaseStatus(
        input.torqueWrenchProfileId,
        released,
        input.owner,
        now
      )
    };
  }

  async releaseForOwner(
    tx: Prisma.TransactionClient,
    owner: UsageLeaseOwnerIdentity,
    reason: string,
    action: string
  ): Promise<void> {
    const candidates = await this.repository.listForOwner(tx, owner);
    for (const candidate of candidates) {
      await this.repository.lockProfile(tx, candidate.torqueWrenchProfileId);
      const current = await this.repository.find(tx, candidate.torqueWrenchProfileId);
      if (!current || current.releasedAt !== null || !isSameUsageLeaseOwner(current, owner)) continue;
      await this.release(
        tx,
        {
          torqueWrenchProfileId: candidate.torqueWrenchProfileId,
          leaseId: current.leaseId,
          generation: current.generation,
          owner,
          reason
        },
        reason,
        action
      );
    }
  }
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + TORQUE_USAGE_LEASE_TTL_MS);
}

function invalidClientError(): ApiError {
  return new ApiError(401, 'クライアント端末が見つかりません', undefined, 'INVALID_CLIENT_KEY');
}

function assertCurrentToken(
  row: TorqueWrenchUsageLeaseRow | null,
  input: UsageLeaseTokenInput
): asserts row is TorqueWrenchUsageLeaseRow {
  if (!row || !isSameUsageLeaseToken(row, input)) {
    throw new ApiError(
      409,
      'トルクレンチ接続権は新しい世代へ移行しました',
      undefined,
      'TORQUE_WRENCH_LEASE_FENCED'
    );
  }
}

function assertCurrentOwner(
  row: TorqueWrenchUsageLeaseRow,
  owner: UsageLeaseOwnerIdentity
): void {
  if (row.ownerClientDeviceId !== owner.clientDeviceId) {
    throw new ApiError(
      409,
      'この端末はトルクレンチ接続権を所有していません',
      undefined,
      'TORQUE_WRENCH_LEASE_OWNER_MISMATCH'
    );
  }
  if (!isSameUsageLeaseOwner(row, owner)) {
    throw new ApiError(
      409,
      'トルクレンチ接続権は別の作業セッションに割り当てられています',
      undefined,
      'TORQUE_WRENCH_LEASE_SESSION_MISMATCH'
    );
  }
}
