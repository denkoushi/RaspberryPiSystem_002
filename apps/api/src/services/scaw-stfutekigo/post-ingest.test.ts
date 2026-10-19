import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from './constants.js';

const sync = vi.fn();
vi.mock('./sync.service.js', () => ({
  ScawStfutekigoSyncService: vi.fn().mockImplementation(function () {
    return { syncFromScawStfutekigoDashboard: sync };
  }),
}));

// Import after the mock so the post-ingest service receives the injected fake.
const { CsvDashboardPostIngestService } = await import('../csv-dashboard/csv-dashboard-post-ingest.service.js');

describe('scawSTFUTEKIGO post-ingest wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sync.mockResolvedValue({ ingestRunId: 'run', rowsScanned: 1 });
  });

  it('requires and forwards the completed ingest run id', async () => {
    const service = new CsvDashboardPostIngestService();
    const result = await service.runAfterSuccessfulIngest({
      dashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
      ingestSource: 'gmail',
      ingestRunId: 'run',
    });
    expect(sync).toHaveBeenCalledWith({ ingestRunId: 'run' });
    expect(result.scawStfutekigoSync).toEqual({ ingestRunId: 'run', rowsScanned: 1 });
  });

  it('rejects a missing run id', async () => {
    const service = new CsvDashboardPostIngestService();
    await expect(
      service.runAfterSuccessfulIngest({ dashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID, ingestSource: 'manual' })
    ).rejects.toThrow('ingestRunId is required');
  });
});
