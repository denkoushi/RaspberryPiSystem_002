import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeRawMock } = vi.hoisted(() => ({ executeRawMock: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $executeRaw: executeRawMock },
}));

import { CsvDashboardDedupCleanupService } from '../csv-dashboard-dedup-cleanup.service.js';

const baseParams = {
  csvDashboardId: 'dashboard-1',
  keyColumns: ['equipmentManagementNumber', 'inspectionItem'],
  keys: [{ equipmentManagementNumber: 'M-1', inspectionItem: '油量' }],
  winnerOrder: [],
};

const executedSql = (): Prisma.Sql[] => executeRawMock.mock.calls.map((call) => call[0] as Prisma.Sql);

describe('CsvDashboardDedupCleanupService.deleteDuplicateLosersForKeys', () => {
  beforeEach(() => {
    executeRawMock.mockReset();
  });

  it('dataHashes 未指定ならキー一致だけで候補を決める（従来どおり）', async () => {
    executeRawMock.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    const result = await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys(baseParams);

    expect(result).toEqual({ deletedCount: 2 });
    expect(executeRawMock).toHaveBeenCalledTimes(2);
    expect(executedSql()[0]?.sql).not.toContain('"dataHash"');
  });

  it('dataHashes 指定時は dataHash の index で候補を絞り、重複ハッシュは除いて1つの配列で渡す', async () => {
    executeRawMock.mockResolvedValueOnce(0);

    await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys({
      ...baseParams,
      dataHashes: ['h1', 'h2', 'h1', ''],
    });

    const sql = executedSql()[0];
    expect(sql?.sql).toContain('r."dataHash" = ANY(');
    expect(sql?.values).toContainEqual(['h1', 'h2']);
  });

  it('dataHashes が空ならDBへ問い合わせない', async () => {
    const result = await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys({
      ...baseParams,
      dataHashes: [],
    });

    expect(result).toEqual({ deletedCount: 0 });
    expect(executeRawMock).not.toHaveBeenCalled();
  });
});
