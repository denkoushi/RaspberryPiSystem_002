import { describe, expect, it } from 'vitest';
import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';

describe('CsvDashboardIngestor.extractDedupKeysFromRows', () => {
  it('dedup key を重複排除して返す', () => {
    const rows = [
      { data: { a: 'x', b: '1', c: 'ignored' } },
      { data: { a: 'x', b: '1', c: 'ignored-2' } },
      { data: { a: 'y', b: '2' } },
    ];

    const result = CsvDashboardIngestor.extractDedupKeysFromRows({
      rows,
      keyColumns: ['a', 'b'],
    });

    expect(result).toEqual([
      { a: 'x', b: '1' },
      { a: 'y', b: '2' },
    ]);
  });

  it('keyColumns が空なら空配列', () => {
    const result = CsvDashboardIngestor.extractDedupKeysFromRows({
      rows: [{ data: { a: 'x' } }],
      keyColumns: [],
    });

    expect(result).toEqual([]);
  });
});

