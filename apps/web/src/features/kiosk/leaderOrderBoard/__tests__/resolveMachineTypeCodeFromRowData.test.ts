import { describe, expect, it } from 'vitest';

import { resolveMachineTypeCodeFromRowData } from '../resolveMachineTypeCodeFromRowData';

describe('resolveMachineTypeCodeFromRowData', () => {
  it('returns first non-empty configured key', () => {
    expect(resolveMachineTypeCodeFromRowData({ FKISYU: 'DAD3350', FHINCD: 'X' })).toBe('DAD3350');
  });

  it('falls through key order', () => {
    expect(resolveMachineTypeCodeFromRowData({ FKIGIS: '  ABC12  ' })).toBe('ABC12');
  });

  it('returns empty when absent', () => {
    expect(resolveMachineTypeCodeFromRowData({ ProductNo: '1' })).toBe('');
  });
});
