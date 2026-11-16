import { describe, expect, it, vi } from 'vitest';
import { readPartNamesByPartNumbers } from '../repositories/prisma-work-instruction-part-names.js';

describe('part names lookup reader', () => {
  it('normalizes and deduplicates keys and preserves trimmed nullable names', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([
      { partNumber: 'AB1', partName: ' Name ' }, { partNumber: 'AB2', partName: '  ' },
      { partNumber: 'AB3', partName: null },
    ]);
    expect(await readPartNamesByPartNumbers({ $queryRaw: query }, [' ａｂ1 ', 'ab1', 'AB2', 'AB3'])).toEqual(
      new Map([['AB1', 'Name'], ['AB2', null], ['AB3', null]])
    );
    const sql = query.mock.calls[1]![0];
    expect(sql.sql).toContain('FROM "ProductionSchedulePartNameLookup"');
    expect(sql.values).toEqual(['AB1', 'AB2', 'AB3']);
  });

  it('uses the legacy query only when the built state is absent', async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ partNumber: 'AB1', partName: 'Legacy' }]);
    expect(await readPartNamesByPartNumbers({ $queryRaw: query }, ['ab1'])).toEqual(new Map([['AB1', 'Legacy']]));
    expect(query.mock.calls[1]![0].sql).toContain('FROM "CsvDashboardRow"');
  });

  it('does not fall back for a built but empty lookup', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    expect(await readPartNamesByPartNumbers({ $queryRaw: query }, ['ab1'])).toEqual(new Map());
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not query for empty normalized input', async () => {
    const query = vi.fn();
    expect(await readPartNamesByPartNumbers({ $queryRaw: query }, ['', '  '])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
