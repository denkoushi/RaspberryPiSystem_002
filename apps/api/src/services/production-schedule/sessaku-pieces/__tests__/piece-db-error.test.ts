import { describe, expect, it } from 'vitest';
import { isAutoUnitSplitBusyError, sessakuPieceSqlState } from '../piece-db-error.js';

describe('auto unit split database contention', () => {
  it.each(['55P03', '57014'])('reads native and PG adapter SQLSTATE %s', (code) => {
    for (const meta of [{ code }, { driverAdapterError: { cause: { originalCode: code } } }]) {
      const error = { code: 'P2010', meta };
      expect(sessakuPieceSqlState(error)).toBe(code);
      expect(isAutoUnitSplitBusyError(error)).toBe(true);
    }
  });
  it.each(['P2028', 'P2024'])('treats transaction timeout/pool wait %s as busy', (code) => {
    expect(isAutoUnitSplitBusyError({ code })).toBe(true);
  });
  it.each([null, undefined, {}, { code: 'P2034' }, { code: 'P2010', meta: { code: '23505' } }])('preserves other errors: %j', (error) => {
    expect(isAutoUnitSplitBusyError(error)).toBe(false);
  });
});
