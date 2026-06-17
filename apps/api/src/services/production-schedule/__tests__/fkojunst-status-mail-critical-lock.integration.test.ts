import { describe, expect, it, vi } from 'vitest';

vi.mock('../fkojunst-status-mail-critical-lock.js', () => ({
  acquireFkojunstStatusMailCriticalTransactionLock: vi.fn(async () => undefined),
}));

import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { runFkojunstMailClearTransaction } from '../fkojunst-status-mail-sync.pipeline.js';

describe('fkojunst-status-mail-sync.pipeline lock integration', () => {
  it('uses shared critical lock helper during clear transaction', async () => {
    const tx = {
      productionScheduleFkojunstMailStatus: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const client = {
      $transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    await runFkojunstMailClearTransaction(client as never, 0, 0, 0);

    expect(acquireFkojunstStatusMailCriticalTransactionLock).toHaveBeenCalledWith(tx);
  });
});
