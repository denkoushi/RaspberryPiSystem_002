import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag } from '../../../api/client';

import { useInventoryNfcQueue } from './useInventoryNfcQueue';

vi.mock('../../../api/client', () => ({ resolveInventoryTag: vi.fn() }));

describe('useInventoryNfcQueue', () => {
  it.each([false, true])('uses the latest canIssue after a pending lookup, allowed=%s', async allowed => {
    let resolveLookup!: (tag: unknown) => void;
    vi.mocked(resolveInventoryTag).mockReturnValue(new Promise(resolve => { resolveLookup = resolve; }) as never);
    const drainEventsRef = { current: async () => {} };
    const runOperation = vi.fn().mockResolvedValue(undefined);
    const options = {
      drainEventsRef, runOperation,
      drainingRef: { current: false }, flowRef: { current: { processing: false } },
      eventQueueRef: { current: [{ uid: 'quantity', timestamp: 'now' }] },
      mountedRef: { current: true }, setPanel: vi.fn(),
    };
    const { rerender } = renderHook(({ canIssue }) => useInventoryNfcQueue({
      ...options, canIssue,
    } as never), { initialProps: { canIssue: () => !allowed } });
    let draining!: Promise<void>;
    act(() => { draining = drainEventsRef.current(); });
    rerender({ canIssue: () => allowed });
    await act(async () => {
      resolveLookup({ kind: 'QUANTITY', uid: 'quantity', quantity: 1 });
      await draining;
    });
    expect(runOperation).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});
