import { describe, expect, it } from 'vitest';

import { isAssemblyUniqueConstraintError } from '../assembly-prisma-errors.js';

describe('isAssemblyUniqueConstraintError', () => {
  it('accepts only Prisma P2002-shaped errors', () => {
    expect(isAssemblyUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isAssemblyUniqueConstraintError({ code: 'P2003' })).toBe(false);
    expect(isAssemblyUniqueConstraintError(new Error('failed'))).toBe(false);
    expect(isAssemblyUniqueConstraintError(null)).toBe(false);
  });
});
