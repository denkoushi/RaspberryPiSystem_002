import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';
import {
  extractFkojunstStatusMailRowsRevisionFromLeaderboardShellSnapshotGenerationToken,
  type LeaderboardShellSnapshotGenerationTokenDetails
} from './leaderboard-shell-snapshot-generation.js';
import type {
  LeaderboardShellSnapshotRecord,
  LeaderboardShellSnapshotStore
} from './leaderboard-shell-snapshot.store.js';

export type LeaderboardLaborMetadataSnapshotContext =
  | {
      kind: 'hit';
      generationTokenDetails: LeaderboardShellSnapshotGenerationTokenDetails;
      snapshotIdCount: number;
      orderedRowIdCount: number;
    }
  | {
      kind: 'miss';
      reason:
        | 'noSnapshotIds'
        | 'noSnapshotStore'
        | 'snapshotMissing'
        | 'scopeMismatch'
        | 'generationTokenMismatch'
        | 'generationTokenWithoutMailRevision'
        | 'rowScopeMismatch';
      snapshotIdCount: number;
    };

function normalizeOptionalKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function snapshotScopeMatches(params: {
  snapshot: LeaderboardShellSnapshotRecord;
  locationKey: string;
  siteKey?: string;
}): boolean {
  return (
    params.snapshot.locationKey === params.locationKey &&
    normalizeOptionalKey(params.snapshot.siteKey) === normalizeOptionalKey(params.siteKey)
  );
}

function uniqueSnapshotIds(snapshotIds: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of snapshotIds ?? []) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveLeaderboardLaborMetadataSnapshotContext(params: {
  snapshotStore?: LeaderboardShellSnapshotStore;
  snapshotIds?: readonly string[];
  orderedRowIds: readonly string[];
  locationKey: string;
  siteKey?: string;
}): LeaderboardLaborMetadataSnapshotContext {
  const snapshotIds = uniqueSnapshotIds(params.snapshotIds);
  if (snapshotIds.length === 0) {
    return { kind: 'miss', reason: 'noSnapshotIds', snapshotIdCount: 0 };
  }
  if (!params.snapshotStore) {
    return { kind: 'miss', reason: 'noSnapshotStore', snapshotIdCount: snapshotIds.length };
  }

  const snapshots: LeaderboardShellSnapshotRecord[] = [];
  for (const snapshotId of snapshotIds) {
    const snapshot = params.snapshotStore.get(snapshotId);
    if (!snapshot) {
      return { kind: 'miss', reason: 'snapshotMissing', snapshotIdCount: snapshotIds.length };
    }
    if (
      !snapshotScopeMatches({
        snapshot,
        locationKey: params.locationKey,
        siteKey: params.siteKey
      })
    ) {
      return { kind: 'miss', reason: 'scopeMismatch', snapshotIdCount: snapshotIds.length };
    }
    snapshots.push(snapshot);
  }

  const generationTokens = new Set(snapshots.map((snapshot) => snapshot.generationToken));
  if (generationTokens.size !== 1) {
    return { kind: 'miss', reason: 'generationTokenMismatch', snapshotIdCount: snapshotIds.length };
  }
  const generationToken = snapshots[0]?.generationToken ?? '';
  const fkojunstStatusMailRowsRevision =
    extractFkojunstStatusMailRowsRevisionFromLeaderboardShellSnapshotGenerationToken(generationToken);
  if (!fkojunstStatusMailRowsRevision) {
    return {
      kind: 'miss',
      reason: 'generationTokenWithoutMailRevision',
      snapshotIdCount: snapshotIds.length
    };
  }

  const trustedIds = new Set<string>();
  for (const snapshot of snapshots) {
    for (const rowId of snapshot.orderedRowIds) {
      trustedIds.add(rowId);
    }
  }
  const orderedRowIds = normalizeLeaderboardDisplayRowIdScope(params.orderedRowIds);
  if (!orderedRowIds.every((rowId) => trustedIds.has(rowId))) {
    return { kind: 'miss', reason: 'rowScopeMismatch', snapshotIdCount: snapshotIds.length };
  }

  return {
    kind: 'hit',
    generationTokenDetails: {
      generationToken,
      fkojunstStatusMailRowsRevision
    },
    snapshotIdCount: snapshotIds.length,
    orderedRowIdCount: orderedRowIds.length
  };
}
