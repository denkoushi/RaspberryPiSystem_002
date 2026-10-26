import { createInMemoryLeaderboardShellSnapshotStore } from './leaderboard-shell-snapshot.store.js';

function resolveLeaderboardShellSnapshotTtlMs(): number {
  const raw = process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
  if (raw == null || raw.trim() === '') {
    return 5 * 60 * 1000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 ? n : 5 * 60 * 1000;
}

export const leaderboardShellSnapshotStore = createInMemoryLeaderboardShellSnapshotStore({
  defaultTtlMs: resolveLeaderboardShellSnapshotTtlMs()
});

