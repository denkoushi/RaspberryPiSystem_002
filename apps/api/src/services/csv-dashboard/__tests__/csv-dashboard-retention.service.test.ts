import { describe, expect, it, vi } from 'vitest';

import { CsvDashboardStorage } from '../../../lib/csv-dashboard-storage.js';
import { CsvDashboardRetentionService } from '../csv-dashboard-retention.service.js';

describe('CsvDashboardRetentionService', () => {
  it('cleanup は DB削除結果とファイル削除結果を集約して返す', async () => {
    const csvDashboardService = {
      cleanupOldData: vi.fn().mockResolvedValue({
        deletedRows: 10,
        deletedIngestRuns: 3,
      }),
    };
    const cleanupOldFilesSpy = vi
      .spyOn(CsvDashboardStorage, 'cleanupOldFiles')
      .mockResolvedValue({ deletedCount: 4, deletedSize: 2048 });

    const service = new CsvDashboardRetentionService(csvDashboardService as never);
    const result = await service.cleanup();

    expect(csvDashboardService.cleanupOldData).toHaveBeenCalledTimes(1);
    expect(cleanupOldFilesSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      deletedRows: 10,
      deletedIngestRuns: 3,
      deletedFiles: 4,
      deletedSize: 2048,
    });
  });
});
