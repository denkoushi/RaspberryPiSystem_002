import { createHash } from 'node:crypto';

import type { WorkInstructionJsonValue } from './types.js';

export type WorkInstructionRevisionState = {
  modified: Date;
  contentHash: string;
};

export type WorkInstructionRevisionDecision = 'APPLY' | 'DUPLICATE' | 'STALE' | 'CONFLICT';

export type WorkInstructionImageDigest = {
  imageName: string;
  sha256: string;
};

function canonicalize(value: WorkInstructionJsonValue): WorkInstructionJsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    const result = Object.create(null) as { [key: string]: WorkInstructionJsonValue };
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(result, key, {
        value: canonicalize(value[key]),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  }
  return value;
}

export function canonicalizeWorkInstructionJson(value: WorkInstructionJsonValue): WorkInstructionJsonValue {
  return canonicalize(value);
}

/**
 * Hashes the complete manifest and the bytes represented by each referenced
 * image digest. Attachment names are sorted for deterministic retries while
 * preserving the manifest's original JSON in the database.
 */
export function computeWorkInstructionContentHash(
  manifest: WorkInstructionJsonValue,
  imageDigests: ReadonlyArray<WorkInstructionImageDigest>
): string {
  const seen = new Map<string, string>();
  for (const digest of imageDigests) {
    const previous = seen.get(digest.imageName);
    if (previous && previous !== digest.sha256) {
      throw new Error(`image ${digest.imageName} has conflicting digests`);
    }
    seen.set(digest.imageName, digest.sha256);
  }
  const canonicalImages = [...seen.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([imageName, sha256]) => ({ imageName, sha256 }));
  const payload = canonicalize({
    manifest,
    images: canonicalImages
  } as unknown as WorkInstructionJsonValue);
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export function decideWorkInstructionRevision(
  current: WorkInstructionRevisionState | null,
  incoming: WorkInstructionRevisionState
): WorkInstructionRevisionDecision {
  if (!current) return 'APPLY';
  const incomingMs = incoming.modified.getTime();
  const currentMs = current.modified.getTime();
  if (incomingMs > currentMs) return 'APPLY';
  if (incomingMs < currentMs) return 'STALE';
  if (incoming.contentHash === current.contentHash) return 'DUPLICATE';
  return 'CONFLICT';
}
