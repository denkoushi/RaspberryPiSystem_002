import { describe, expect, it, vi } from 'vitest';
import { loadCancelledLoanIdSet } from '../load-cancelled-loan-id-set.js';

describe('loadCancelledLoanIdSet', () => {
  it('returns empty Set without calling findMany when loanIds is empty', async () => {
    const findMany = vi.fn();
    const prisma = { loan: { findMany } };
    const result = await loadCancelledLoanIdSet(prisma as never, []);
    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('dedupes ids and returns Set of cancelled loan ids', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const prisma = { loan: { findMany } };
    const result = await loadCancelledLoanIdSet(prisma as never, ['a', 'a', 'b']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['a', 'b'] },
          cancelledAt: { not: null },
        }),
      }),
    );
    expect(result).toEqual(new Set(['a', 'b']));
  });
});
