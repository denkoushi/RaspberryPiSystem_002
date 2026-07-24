import type { TorqueWrenchRejectionReason } from '@raspi-system/shared-types';

export type TorqueWrenchConfirmationEvidence = {
  id: string;
  sessionId: string;
  torqueWrenchProfileId: string;
  settingHistoryId: string;
  conditionFingerprint: string;
  clientDeviceId: string | null;
  confirmedAt: Date;
};

export type TorqueWrenchLeaseEvidence = {
  leaseId: string;
  generation: number;
  adoptedConfirmationId: string | null;
  ownerClientDeviceId: string;
  ownerSessionId: string;
  acquiredAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
};

export type TorqueWrenchConfirmationExpectation = {
  sessionId: string;
  clientDeviceId: string;
  torqueWrenchProfileId: string;
  settingHistoryId: string;
  conditionFingerprint: string;
};

export type ConfirmationUseMode = 'current_session' | 'adopted_reuse';

export type ConfirmationUseDecision =
  | { allowed: true; mode: ConfirmationUseMode }
  | { allowed: false; reason: TorqueWrenchRejectionReason };

export type AgentLeaseUseDecision =
  | { allowed: true; mode: 'lease' | 'legacy' }
  | { allowed: false; reason: TorqueWrenchRejectionReason };

function rejected(reason: TorqueWrenchRejectionReason): ConfirmationUseDecision {
  return { allowed: false, reason };
}

/**
 * Pure domain policy for deciding whether one physical-confirmation audit row
 * may be used for the work and terminal currently in front of the operator.
 * Database reads and eligibility evaluation deliberately live outside this
 * class so every caller applies the same identity and ownership rules.
 */
export class TorqueWrenchConfirmationUsePolicy {
  private evaluateCommon(
    confirmation: TorqueWrenchConfirmationEvidence,
    expected: TorqueWrenchConfirmationExpectation
  ): ConfirmationUseDecision | null {
    if (confirmation.torqueWrenchProfileId !== expected.torqueWrenchProfileId) {
      return rejected('WRONG_PHYSICAL_WRENCH');
    }
    if (confirmation.clientDeviceId !== expected.clientDeviceId) {
      return rejected('CONFIRMATION_REQUIRED');
    }
    if (
      confirmation.settingHistoryId !== expected.settingHistoryId ||
      confirmation.conditionFingerprint !== expected.conditionFingerprint
    ) {
      return rejected('CONFIRMATION_STALE');
    }
    return null;
  }

  evaluateCurrentSession(
    confirmation: TorqueWrenchConfirmationEvidence,
    expected: TorqueWrenchConfirmationExpectation
  ): ConfirmationUseDecision {
    const common = this.evaluateCommon(confirmation, expected);
    if (common) return common;
    return confirmation.sessionId === expected.sessionId
      ? { allowed: true, mode: 'current_session' }
      : rejected('CONFIRMATION_REQUIRED');
  }

  evaluateAdoptedReuse(
    confirmation: TorqueWrenchConfirmationEvidence,
    lease: TorqueWrenchLeaseEvidence | null,
    expected: TorqueWrenchConfirmationExpectation
  ): ConfirmationUseDecision {
    const common = this.evaluateCommon(confirmation, expected);
    if (common) return common;
    if (
      !lease ||
      lease.ownerClientDeviceId !== expected.clientDeviceId ||
      lease.adoptedConfirmationId !== confirmation.id
    ) {
      return rejected('CONFIRMATION_REQUIRED');
    }
    return { allowed: true, mode: 'adopted_reuse' };
  }

  evaluateLeaseAdoption(input: {
    confirmation: TorqueWrenchConfirmationEvidence;
    lease: TorqueWrenchLeaseEvidence | null;
    expected: TorqueWrenchConfirmationExpectation;
    now: Date;
  }): ConfirmationUseDecision {
    const adopted = this.evaluateAdoptedReuse(
      input.confirmation,
      input.lease,
      input.expected
    );
    if (adopted.allowed) return adopted;

    const currentSession = this.evaluateCurrentSession(
      input.confirmation,
      input.expected
    );
    if (!currentSession.allowed) return currentSession;

    const lease = input.lease;
    if (!lease || lease.ownerClientDeviceId === input.expected.clientDeviceId) {
      return currentSession;
    }

    const ownershipBoundary = lease.releasedAt
      ?? (lease.expiresAt.getTime() <= input.now.getTime()
        ? lease.expiresAt
        : lease.acquiredAt);
    return input.confirmation.confirmedAt.getTime() > ownershipBoundary.getTime()
      ? currentSession
      : rejected('CONFIRMATION_REQUIRED');
  }

  evaluateAgentLease(input: {
    lease: TorqueWrenchLeaseEvidence | null;
    leaseEnforced: boolean;
    leaseId?: string | null;
    generation?: number | null;
    confirmationId: string;
    clientDeviceId: string;
    sessionId: string;
  }): AgentLeaseUseDecision {
    const hasLeaseId = typeof input.leaseId === 'string' && input.leaseId.length > 0;
    const hasGeneration = Number.isInteger(input.generation) && Number(input.generation) > 0;
    if (!hasLeaseId || !hasGeneration) {
      return input.leaseEnforced
        ? { allowed: false, reason: 'CONNECTION_LEASE_REQUIRED' }
        : { allowed: true, mode: 'legacy' };
    }
    const lease = input.lease;
    if (
      !lease ||
      lease.leaseId !== input.leaseId ||
      lease.generation !== input.generation
    ) {
      return { allowed: false, reason: 'CONNECTION_LEASE_FENCED' };
    }
    if (lease.ownerClientDeviceId !== input.clientDeviceId) {
      return { allowed: false, reason: 'CONNECTION_LEASE_OWNER_MISMATCH' };
    }
    if (lease.ownerSessionId !== input.sessionId) {
      return { allowed: false, reason: 'CONNECTION_LEASE_SESSION_MISMATCH' };
    }
    if (lease.adoptedConfirmationId !== input.confirmationId) {
      return { allowed: false, reason: 'CONFIRMATION_REQUIRED' };
    }
    return { allowed: true, mode: 'lease' };
  }
}
