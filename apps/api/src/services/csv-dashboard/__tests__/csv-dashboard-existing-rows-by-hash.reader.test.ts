import { describe, expect, it, vi } from 'vitest';

import {
  CSV_DASHBOARD_DATA_HASH_FINDMANY_DEFAULT_CHUNK_SIZE,
  findCsvDashboardRowsByDataHashes,
  maxDataHashesPerFindManyQuery,
} from '../csv-dashboard-existing-rows-by-hash.reader.js';

describe('findCsvDashboardRowsByDataHashes', () => {
  it('dataHashes が空なら findMany を呼ばず空配列', async () => {
    const findMany = vi.fn();
    const result = await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: [],
    });
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('有効な hash が無い（空文字のみ）なら findMany を呼ばない', async () => {
    const findMany = vi.fn();
    const result = await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: ['', '', ''],
    });
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('chunkSize が上限を超えても 1 クエリあたりの IN はクランプされる', async () => {
    const findMany = vi.fn().mockImplementation(async () => []);
    const hashes = Array.from({ length: 40000 }, (_, i) => `x${i}`);
    await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: hashes,
      chunkSize: 9_999_999,
    });
    const maxIn = Math.max(...findMany.mock.calls.map((c) => (c[0].where.dataHash.in as string[]).length));
    expect(maxIn).toBeLessThanOrEqual(maxDataHashesPerFindManyQuery());
  });

  it('重複ハッシュは1クエリにまとめられる', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'r1', dataHash: 'abc', occurredAt: new Date(), rowData: {} }]);
    await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: ['abc', 'abc', 'abc'],
      chunkSize: 10_000,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardId: 'dash-1', dataHash: { in: ['abc'] } },
      })
    );
  });

  it('32768 件のユニーク hash で複数回 findMany する（既定チャンク）', async () => {
    const findMany = vi.fn().mockImplementation(async () => []);
    const hashes = Array.from({ length: 32768 }, (_, i) => `h${i}`);
    await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: hashes,
    });

    const expectedChunks = Math.ceil(32768 / CSV_DASHBOARD_DATA_HASH_FINDMANY_DEFAULT_CHUNK_SIZE);
    expect(findMany).toHaveBeenCalledTimes(expectedChunks);
    const sizes = findMany.mock.calls.map((c) => (c[0].where.dataHash.in as string[]).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(32768);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(maxDataHashesPerFindManyQuery());
  });

  it('チャンク結果を結合して返す', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a', dataHash: '1', occurredAt: new Date(), rowData: {} }])
      .mockResolvedValueOnce([{ id: 'b', dataHash: '2', occurredAt: new Date(), rowData: {} }]);
    const result = await findCsvDashboardRowsByDataHashes({
      client: { findMany },
      csvDashboardId: 'dash-1',
      dataHashes: ['1', '2'],
      chunkSize: 1,
    });
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
