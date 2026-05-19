const DEFAULT_SNAPSHOT_TOTAL_TTL_MS = 5 * 60 * 1000;

type CachedSnapshotTotal = {
  expiresAtMs: number;
  total: number;
};

/** board shell で確定したスロット別 visible total（continue 時の COUNT 省略用） */
const totalBySnapshotId = new Map<string, CachedSnapshotTotal>();

function resolveSnapshotTotalTtlMs(): number {
  const raw = process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
  if (raw == null || raw.trim() === '') {
    return DEFAULT_SNAPSHOT_TOTAL_TTL_MS;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 ? n : DEFAULT_SNAPSHOT_TOTAL_TTL_MS;
}

function gcExpiredSnapshotTotals(now = Date.now()): void {
  for (const [snapshotId, entry] of totalBySnapshotId) {
    if (entry.expiresAtMs < now) {
      totalBySnapshotId.delete(snapshotId);
    }
  }
}

export function seedLeaderboardBoardSnapshotResourceTotal(snapshotId: string, total: number): void {
  const id = snapshotId.trim();
  if (!id.length) return;
  const normalized = Math.max(0, Math.floor(total));
  const now = Date.now();
  gcExpiredSnapshotTotals(now);
  totalBySnapshotId.set(id, {
    expiresAtMs: now + resolveSnapshotTotalTtlMs(),
    total: normalized
  });
}

export function resolveLeaderboardBoardSnapshotResourceTotal(snapshotId: string | undefined): number | undefined {
  gcExpiredSnapshotTotals();
  const id = snapshotId?.trim() ?? '';
  if (!id.length) return undefined;
  const entry = totalBySnapshotId.get(id);
  if (!entry) return undefined;
  return entry.total;
}

/** テスト用 */
export function clearLeaderboardBoardSnapshotResourceTotalsForTests(): void {
  totalBySnapshotId.clear();
}
