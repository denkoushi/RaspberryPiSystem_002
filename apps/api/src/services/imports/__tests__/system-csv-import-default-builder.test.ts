import { describe, expect, it } from 'vitest';
import { D_SCHEDULE_MINUTES_SCHEDULE_ID, resolveSystemCsvImportDefaultBuilder } from '../system-csv-import-schedule-builtin-rows.js';
import { normalizeSystemCsvImportRowForPersistence } from '../system-csv-import-schedule-invariants.js';

describe('resolveSystemCsvImportDefaultBuilder', () => {
  it('returns builders only for reserved schedule ids', () => {
    expect(resolveSystemCsvImportDefaultBuilder(D_SCHEDULE_MINUTES_SCHEDULE_ID)).toBeTypeOf('function');
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'user-schedule']) {
      expect(resolveSystemCsvImportDefaultBuilder(id)).toBeNull();
    }
  });

  it('leaves user rows with inherited property names unchanged', () => {
    const row = { id: 'constructor', name: 'x', targets: [], schedule: '0 1 * * *', enabled: true } as never;
    expect(normalizeSystemCsvImportRowForPersistence(row)).toBe(row);
  });
});
