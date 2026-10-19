import { describe, expect, it } from 'vitest';

import {
  dedupeAndSortWorkInstructionTargets,
  normalizeWorkInstructionPartNumber
} from './workInstructionRules';

describe('workInstructionRules', () => {
  it('normalizes FHINCD with NFKC, trim, and uppercase', () => {
    expect(normalizeWorkInstructionPartNumber('  ａｂ－１２３  ')).toBe('AB-123');
    expect(normalizeWorkInstructionPartNumber(' \t ')).toBe('');
    expect(normalizeWorkInstructionPartNumber(undefined)).toBe('');
  });

  it('deduplicates targets and sorts categories before numeric-natural values', () => {
    const targets = ['582', '研削', '10', '切削', '2', '581', '10', 'A10', 'A2'];

    expect(dedupeAndSortWorkInstructionTargets(targets)).toEqual([
      '研削',
      '切削',
      '2',
      '10',
      '581',
      '582',
      'A2',
      'A10'
    ]);
    expect(targets).toEqual(['582', '研削', '10', '切削', '2', '581', '10', 'A10', 'A2']);
  });
});
