import { describe, expect, it, vi } from 'vitest';

import { ProcessWideFifoGmailRequestSerializer } from '../gmail-request-serializer.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ProcessWideFifoGmailRequestSerializer', () => {
  it('runs requests in FIFO order with a maximum concurrency of one', async () => {
    const serializer = new ProcessWideFifoGmailRequestSerializer();
    const first = deferred<void>();
    const second = deferred<void>();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const run = (name: string, gate: Promise<void>) =>
      serializer.runExclusive(name, async () => {
        order.push(`start:${name}`);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
        order.push(`end:${name}`);
      });

    const firstRun = run('first', first.promise);
    const secondRun = run('second', second.promise);
    await vi.waitFor(() => expect(order).toEqual(['start:first']));

    first.resolve();
    await firstRun;
    await vi.waitFor(() =>
      expect(order).toEqual(['start:first', 'end:first', 'start:second'])
    );

    second.resolve();
    await secondRun;
    expect(maxActive).toBe(1);
  });

  it('releases the next request after an error, including a timeout-shaped error', async () => {
    const serializer = new ProcessWideFifoGmailRequestSerializer();
    const order: string[] = [];
    const timeout = Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' });

    const failed = serializer.runExclusive('first', async () => {
      order.push('first');
      throw timeout;
    });
    const next = serializer.runExclusive('second', async () => {
      order.push('second');
      return 'ok';
    });

    await expect(failed).rejects.toBe(timeout);
    await expect(next).resolves.toBe('ok');
    expect(order).toEqual(['first', 'second']);
  });
});
