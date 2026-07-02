import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as generation from '../leaderboard-shell-snapshot-generation.js';
import * as materialization from '../../row-resolver/max-product-no-winner-materialization.js';
import {
  clearLeaderboardMaterializedWinnerCacheForTests,
  resolveLeaderboardMaterializedBaseWhereWithGenerationCache
} from '../leaderboard-materialized-winner-cache.js';

describe('leaderboard-materialized-winner-cache', () => {
  const prisma = { $queryRaw: vi.fn() } as never;
  const baseWhereA = Prisma.sql`WHERE token-a`;
  const baseWhereB = Prisma.sql`WHERE token-b`;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearLeaderboardMaterializedWinnerCacheForTests();
  });

  it('reuses materialization when generation token is unchanged', async () => {
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationToken').mockResolvedValue('token-a');
    const buildSpy = vi
      .spyOn(materialization, 'buildProductionScheduleLeaderboardMaterializedBaseWhere')
      .mockResolvedValue(baseWhereA);

    const first = await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);
    const second = await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(baseWhereA);
    expect(second).toBe(baseWhereA);
  });

  it('rebuilds materialization when generation token changes', async () => {
    const readSpy = vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationToken');
    readSpy.mockResolvedValueOnce('token-a').mockResolvedValueOnce('token-b');
    const buildSpy = vi
      .spyOn(materialization, 'buildProductionScheduleLeaderboardMaterializedBaseWhere')
      .mockResolvedValueOnce(baseWhereA)
      .mockResolvedValueOnce(baseWhereB);

    const first = await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);
    const second = await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);

    expect(buildSpy).toHaveBeenCalledTimes(2);
    expect(first).toBe(baseWhereA);
    expect(second).toBe(baseWhereB);
  });

  it('shares in-flight materialization for concurrent calls with the same token', async () => {
    vi.spyOn(generation, 'readLeaderboardShellSnapshotGenerationToken').mockResolvedValue('token-a');
    let resolveBuild!: (value: Prisma.Sql) => void;
    const buildSpy = vi
      .spyOn(materialization, 'buildProductionScheduleLeaderboardMaterializedBaseWhere')
      .mockImplementation(
        () =>
          new Promise<Prisma.Sql>((resolve) => {
            resolveBuild = resolve;
          })
      );

    const pendingA = resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);
    const pendingB = resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma);

    await Promise.resolve();

    expect(buildSpy).toHaveBeenCalledTimes(1);

    resolveBuild(baseWhereA);
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);

    expect(resultA).toBe(baseWhereA);
    expect(resultB).toBe(baseWhereA);
  });
});
