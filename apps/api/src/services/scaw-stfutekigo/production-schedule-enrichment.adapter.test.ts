import { describe, expect, it, vi } from 'vitest';
import { ProductionScheduleScawStfutekigoEnrichmentAdapter } from './production-schedule-enrichment.adapter.js';

describe('ProductionScheduleScawStfutekigoEnrichmentAdapter', () => {
  it('resolves only distinct primary FHINCD candidates and delegates machine names by FSEIBAN', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        orderKey: '000123',
        partNumber: 'P-1',
        partName: '部品',
        resolvedSeiban: 'S-1',
      },
      // Same FHINCD means multiple process rows are one candidate after SQL grouping.
    ]);
    const resolveMachineNames = vi.fn().mockResolvedValue({ machineNames: { 'S-1': '機種A' } });
    const adapter = new ProductionScheduleScawStfutekigoEnrichmentAdapter({ $queryRaw: queryRaw }, resolveMachineNames);
    const result = await adapter.enrich(['000123']);
    expect(result.get('000123')).toEqual({
      partNumber: 'P-1',
      partName: '部品',
      machineName: '機種A',
      resolvedSeiban: 'S-1',
      enrichmentStatus: 'RESOLVED',
      enrichedAt: expect.any(Date),
    });
    expect(resolveMachineNames).toHaveBeenCalledWith(['S-1']);
    const sql = String(queryRaw.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('ProductNo');
    expect(sql).toContain('MH%');
    expect(sql).not.toContain("rowData->>'FSEZONO'");
  });

  it('marks multiple distinct part candidates ambiguous and missing orders not found', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        orderKey: 'A',
        partNumber: 'P-1',
        partName: null,
        resolvedSeiban: null,
      },
      {
        orderKey: 'A',
        partNumber: 'P-2',
        partName: null,
        resolvedSeiban: null,
      },
    ]);
    const resolveMachineNames = vi.fn();
    const adapter = new ProductionScheduleScawStfutekigoEnrichmentAdapter({ $queryRaw: queryRaw }, resolveMachineNames);
    const result = await adapter.enrich([' ａ ', 'B']);
    expect(result.get('A')?.enrichmentStatus).toBe('AMBIGUOUS');
    expect(result.get('B')?.enrichmentStatus).toBe('NOT_FOUND');
    expect(resolveMachineNames).not.toHaveBeenCalled();
  });
});
