/**
 * Evidence captured when an operator confirms a wrench.  The usage-lease
 * generation and adopted confirmation are deliberately copied into the
 * confirmation row so a confirmation made before a handoff cannot re-arm a
 * later owner.
 */
export type TorqueWrenchConfirmationFreshnessEvidence = {
  id: string;
  confirmedAt: Date;
  observedLeaseGeneration?: number | null;
  observedAdoptedConfirmationId?: string | null;
};

export type TorqueWrenchCurrentLeaseFreshnessEvidence = {
  generation: number;
  adoptedConfirmationId: string | null;
  expiresAt: Date;
  releasedAt: Date | null;
};

export type TorqueWrenchConfirmationFreshnessOwner = {
  ownerClientDeviceId: string;
  ownerSessionId: string;
  ownerKind?: string;
};

export type TorqueWrenchConfirmationFreshnessLeaseOwner = TorqueWrenchConfirmationFreshnessOwner & {
  adoptedConfirmationId: string | null;
  generation: number;
  expiresAt: Date;
  releasedAt: Date | null;
  ownerKind?: string;
};

function observedGeneration(evidence: TorqueWrenchConfirmationFreshnessEvidence): number | null {
  return evidence.observedLeaseGeneration ?? null;
}

function observedAdoptedConfirmationId(
  evidence: TorqueWrenchConfirmationFreshnessEvidence
): string | null {
  return evidence.observedAdoptedConfirmationId ?? null;
}

function hasMatchingSnapshot(
  confirmation: TorqueWrenchConfirmationFreshnessEvidence,
  lease: TorqueWrenchCurrentLeaseFreshnessEvidence
): boolean {
  return observedGeneration(confirmation) === lease.generation
    && observedAdoptedConfirmationId(confirmation) === lease.adoptedConfirmationId;
}

/**
 * A confirmation can be pending only for the exact lease epoch observed at
 * confirmation time.  A released or expired epoch additionally requires the
 * physical confirmation to have been made after that ownership boundary.
 */
export function isTorqueWrenchConfirmationFreshForAcquire(
  confirmation: TorqueWrenchConfirmationFreshnessEvidence,
  lease: TorqueWrenchCurrentLeaseFreshnessEvidence | null,
  now = new Date()
): boolean {
  if (!lease) {
    return observedGeneration(confirmation) === 0
      && observedAdoptedConfirmationId(confirmation) === null;
  }

  const active = lease.releasedAt === null && lease.expiresAt.getTime() > now.getTime();
  if (active) return hasMatchingSnapshot(confirmation, lease);

  const boundary = lease.releasedAt ?? lease.expiresAt;
  return confirmation.confirmedAt.getTime() > boundary.getTime()
    && hasMatchingSnapshot(confirmation, lease);
}

/**
 * A retry of an already-adopted confirmation is the one exception to pending
 * snapshot freshness: it is still the same active owner, client, session and
 * lease.  This lets a transient connection retry without another operator
 * confirmation while refusing an old confirmation after release/expiry.
 */
export function isTorqueWrenchConfirmationActiveOwnerRetry(
  confirmation: TorqueWrenchConfirmationFreshnessEvidence,
  lease: TorqueWrenchConfirmationFreshnessLeaseOwner | null,
  owner: TorqueWrenchConfirmationFreshnessOwner,
  now = new Date()
): boolean {
  if (!lease || lease.releasedAt !== null || lease.expiresAt.getTime() <= now.getTime()) return false;
  if (lease.ownerClientDeviceId !== owner.ownerClientDeviceId || lease.ownerSessionId !== owner.ownerSessionId) {
    return false;
  }
  if (lease.ownerKind !== undefined && owner.ownerKind !== undefined && lease.ownerKind !== owner.ownerKind) {
    return false;
  }
  return lease.adoptedConfirmationId === confirmation.id;
}
