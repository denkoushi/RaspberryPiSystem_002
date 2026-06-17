import { describe, expect, it, vi } from 'vitest';

import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';

describe('fkojunst-status-mail-critical-lock', () => {
  it('acquires advisory lock via $executeRaw', async () => {
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const tx = { $executeRaw: executeRaw };

    await acquireFkojunstStatusMailCriticalTransactionLock(tx);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect('$queryRaw' in tx).toBe(false);
  });
});
