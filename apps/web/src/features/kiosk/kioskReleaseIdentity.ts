const FULL_RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERIFICATION_ID_PATTERN = /^[0-9a-f]{32}$/;

interface DeployVerificationIdentity {
  isMaintenance: boolean;
  phase?: string;
  desiredReleaseSha?: string;
  verificationId?: string;
}

export interface KioskReadyChallenge {
  releaseSha: string;
  verificationId: string;
}

export interface KioskVerificationChallenge {
  desiredReleaseSha: string;
  verificationId: string;
}

export function isFullReleaseSha(value: unknown): value is string {
  return typeof value === 'string' && FULL_RELEASE_SHA_PATTERN.test(value);
}

export function resolveKioskVerificationChallenge(
  status: DeployVerificationIdentity | undefined
): KioskVerificationChallenge | null {
  if (status?.isMaintenance !== true || status.phase !== 'verifying') return null;
  if (!isFullReleaseSha(status.desiredReleaseSha)) return null;
  if (typeof status.verificationId !== 'string' || !VERIFICATION_ID_PATTERN.test(status.verificationId)) return null;
  return {
    desiredReleaseSha: status.desiredReleaseSha,
    verificationId: status.verificationId
  };
}

/**
 * Return the immutable release identity this compiled bundle may acknowledge.
 *
 * The desired API value is only a challenge. It must never become the bundle
 * identity: an old browser bundle must remain in maintenance until its own
 * build-time SHA exactly matches that challenge.
 */
export function resolveKioskReadyChallenge(
  status: DeployVerificationIdentity | undefined,
  compiledReleaseSha: string | undefined = import.meta.env.VITE_RELEASE_SHA
): KioskReadyChallenge | null {
  const challenge = resolveKioskVerificationChallenge(status);
  if (!challenge || !isFullReleaseSha(compiledReleaseSha)) return null;
  return compiledReleaseSha === challenge.desiredReleaseSha
    ? { releaseSha: compiledReleaseSha, verificationId: challenge.verificationId }
    : null;
}
