import { describe, expect, it } from 'vitest';

import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard-shell-snapshot.store.js';

describe('leaderboard-shell-snapshot.store', () => {
  it('partialOrdering の snapshot に続きを追記できる', () => {
    const store = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 });
    const snapshotId = store.create({
      orderedRowIds: ['a', 'b'],
      partialOrdering: true,
      filterFingerprint: 'fp',
      generationToken: 'gen',
      locationKey: 'loc',
      siteKey: undefined
    });

    store.appendSnapshotOrderingChunk(snapshotId, ['c', 'd'], false);

    expect(store.get(snapshotId)).toMatchObject({
      orderedRowIds: ['a', 'b', 'c', 'd'],
      partialOrdering: true
    });
  });

  it('mergeFullyCompleted=true のとき partialOrdering を閉じる', () => {
    const store = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 10_000 });
    const snapshotId = store.create({
      orderedRowIds: ['a'],
      partialOrdering: true,
      filterFingerprint: 'fp',
      generationToken: 'gen',
      locationKey: 'loc',
      siteKey: 'site'
    });

    store.appendSnapshotOrderingChunk(snapshotId, ['b'], true);

    expect(store.get(snapshotId)).toMatchObject({
      orderedRowIds: ['a', 'b'],
      partialOrdering: false
    });
  });
});
