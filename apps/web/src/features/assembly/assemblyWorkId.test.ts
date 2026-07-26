import { describe, expect, it } from 'vitest';

import { buildAssemblyLotWorkIds, createAssemblyRequestId } from './assemblyUiHelpers';

describe('buildAssemblyLotWorkIds', () => {
  it('normalizes full-width ASCII and issues a three-digit sequence', () => {
    expect(buildAssemblyLotWorkIds(' ａｓｍ－００１ ', 3)).toEqual([
      'ASM-001-001',
      'ASM-001-002',
      'ASM-001-003'
    ]);
  });

  it('supports the maximum lot size without reusing numbers', () => {
    const workIds = buildAssemblyLotWorkIds('LOT500', 500);
    expect(workIds).toHaveLength(500);
    expect(workIds[0]).toBe('LOT500-001');
    expect(workIds[499]).toBe('LOT500-500');
    expect(new Set(workIds).size).toBe(500);
  });

  it('rejects quantities outside 1..500 and product numbers that exceed the work ID limit', () => {
    expect(() => buildAssemblyLotWorkIds('LOT', 0)).toThrow();
    expect(() => buildAssemblyLotWorkIds('LOT', 501)).toThrow();
    expect(() => buildAssemblyLotWorkIds('A'.repeat(116), 1)).not.toThrow();
    expect(() => buildAssemblyLotWorkIds('A'.repeat(117), 1)).toThrow();
  });
});

describe('createAssemblyRequestId', () => {
  it('always returns a UUID accepted by the API contract', () => {
    expect(createAssemblyRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
