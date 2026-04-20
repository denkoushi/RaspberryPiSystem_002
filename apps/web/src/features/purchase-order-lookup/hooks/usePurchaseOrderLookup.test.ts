import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/client-key', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/client-key')>();
  return {
    ...actual,
    resolveClientKey: vi.fn(() => ({ key: 'test-key', source: 'default' as const }))
  };
});

import { usePurchaseOrderLookup } from './usePurchaseOrderLookup';

import type { PurchaseOrderLookupResponse } from '../../../api/client';

const sampleResponse: PurchaseOrderLookupResponse = {
  purchaseOrderNo: '0000000001',
  rows: []
};

describe('usePurchaseOrderLookup', () => {
  it('照会中に10桁未満のスキャンが来たとき loading を解除する（進行中リクエストの finally と競合しない）', async () => {
    const lookup = vi.fn(
      () =>
        new Promise<PurchaseOrderLookupResponse>(() => {
          /* 意図的に未解決 */
        })
    );

    const { result } = renderHook(() =>
      usePurchaseOrderLookup({
        debounceMs: 0,
        lookup
      })
    );

    await act(async () => {
      result.current.onOrderNoChange('1234567890');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      result.current.onScanSuccess('12345');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it('10桁スキャンで lookup を呼び結果を反映する', async () => {
    const lookup = vi.fn().mockResolvedValue(sampleResponse);

    const { result } = renderHook(() =>
      usePurchaseOrderLookup({
        debounceMs: 0,
        lookup
      })
    );

    await act(async () => {
      result.current.onScanSuccess('9876543210');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(lookup).toHaveBeenCalledWith('9876543210', 'test-key');
    expect(result.current.result).toEqual(sampleResponse);
    expect(result.current.error).toBeNull();
  });
});
