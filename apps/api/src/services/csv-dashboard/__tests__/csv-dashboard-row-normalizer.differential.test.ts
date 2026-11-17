import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as current from '../csv-dashboard-row-normalizer.js';
import * as legacy from './legacy/csv-dashboard-row-normalizer.legacy.js';
import type { ColumnDefinition } from '../csv-dashboard.types.js';
import { ApiError } from '../../../lib/errors.js';

const value = fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom(
  '', ' ', '\u3000', 'not-a-number', '001.50', '-2', '1e3', 'NaN', 'Infinity',
  'true', 'TRUE', 'True', '1', 'yes', 'YES', 'false', 'FALSE', '0', 'no', ' true ', '2026/11/17'
));
const definitions = fc.array(fc.record({
  dataType: fc.constantFrom('string' as const, 'number' as const, 'date' as const, 'boolean' as const),
  required: fc.option(fc.boolean(), { nil: undefined })
}), { minLength: 1, maxLength: 12 }).map((columns): ColumnDefinition[] => columns.map((column, i) => ({
  ...column, internalName: `c${i}`, displayName: `列${i}`, csvHeaderCandidates: [`Header${i}`, `別名${i}`], order: i
})));
const outcome = <T>(run: () => T) => {
  try { return { success: true, value: run() }; }
  catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { success: false, name: error.name, message: error.message,
      statusCode: error.statusCode, code: error.code, details: error.details };
  }
};

describe('CSV row normalizer differential properties', () => {
  it('matches column mappings and missing-column errors including optional columns', () => {
    fc.assert(fc.property(definitions, fc.array(fc.record({
      index: fc.integer({ min: 0, max: 14 }), alias: fc.boolean(),
      decoration: fc.constantFrom('plain', 'upper', 'spaces', 'quotes', 'bom')
    }), { maxLength: 18 }), (columns, specs) => {
      const headers = specs.map(({ index, alias, decoration }) => {
        const header = alias ? `別名${index}` : `Header${index}`;
        switch (decoration) {
          case 'upper': return header.toUpperCase();
          case 'spaces': return ` \u3000${header}\u3000 `;
          case 'quotes': return `""${header}"`;
          case 'bom': return `\uFEFF${header}`;
          default: return header;
        }
      });
      expect(outcome(() => current.createColumnMapping(headers, columns)))
        .toEqual(outcome(() => legacy.createColumnMapping(headers, columns)));
    }), { numRuns: 1000 });
  });

  it('matches row conversion with empty, missing, numeric and boolean cells and source-string options', () => {
    fc.assert(fc.property(definitions, fc.array(value, { maxLength: 14 }), (columns, row) => {
      const mapping = columns.map((columnDef, csvIndex) => ({ csvIndex, internalName: columnDef.internalName, columnDef }));
      expect(current.normalizeRow(row, mapping)).toEqual(legacy.normalizeRow(row, mapping));
      for (const preserve of [false, true]) {
        expect(current.normalizeRow(row, mapping, preserve)).toEqual(legacy.normalizeRow(row, mapping, preserve));
      }
    }), { numRuns: 1000 });
  });

  it('matches hashes of normalized rows with all columns or selected, repeated and absent keys', () => {
    fc.assert(fc.property(definitions, fc.array(value, { maxLength: 14 }), fc.boolean(),
      fc.array(fc.integer({ min: 0, max: 14 }), { minLength: 1, maxLength: 16 }), (columns, row, preserve, indices) => {
        const mapping = columns.map((columnDef, csvIndex) => ({ csvIndex, internalName: columnDef.internalName, columnDef }));
        const normalized = current.normalizeRow(row, mapping, preserve);
        const oldNormalized = legacy.normalizeRow(row, mapping, preserve);
        for (const keys of [[], indices.map((i) => `c${i}`)]) {
          expect(current.calculateDataHash(normalized, keys)).toBe(legacy.calculateDataHash(oldNormalized, keys));
        }
      }), { numRuns: 1000 });
  });
});
