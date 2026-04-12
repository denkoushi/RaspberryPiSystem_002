import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  parseActualSlipImage: vi.fn(),
  registerOrderPlacement: vi.fn(),
  moveOrderPlacementBranch: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn()
}));

import {
  parseActualSlipImage,
  moveOrderPlacementBranch,
  registerOrderPlacement,
  verifyMobilePlacementSlipMatch
} from '../../api/client';

import { useMobilePlacementPageState } from './useMobilePlacementPageState';

import type { ReactNode } from 'react';

describe('useMobilePlacementPageState', () => {
  it('parseActualSlipImage の製造orderと製番を状態に反映する', async () => {
    vi.mocked(parseActualSlipImage).mockResolvedValue({
      engine: 'stub',
      ocrText: '製造 オー ダ No 0002178005\n製 番 BE1N9321\n注文 番号 0003507502',
      ocrPreviewSafe: '8440002178005 9321 0003507502 85E4-4No0002178005 8BETNO9321 EXES0003507502',
      manufacturingOrder10: '0002178005',
      fseiban: 'BE1N9321'
    });
    vi.mocked(registerOrderPlacement).mockResolvedValue({
      event: {
        id: 'evt-1',
        clientDeviceId: 'dev-1',
        shelfCodeRaw: 'A-01',
        manufacturingOrderBarcodeRaw: '0002178005',
        csvDashboardRowId: 'row-1',
        branchNo: 1,
        actionType: 'CREATE_BRANCH',
        placedAt: '2026-04-11T00:00:00.000Z'
      },
      branchState: { id: 'bs-1', branchNo: 1, shelfCodeRaw: 'A-01' },
      resolvedRowId: 'row-1'
    });
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true });
    vi.mocked(moveOrderPlacementBranch).mockResolvedValue({
      event: {
        id: 'evt-2',
        clientDeviceId: 'dev-1',
        shelfCodeRaw: 'B-02',
        manufacturingOrderBarcodeRaw: '0002178005',
        csvDashboardRowId: 'row-1',
        branchNo: 1,
        actionType: 'MOVE_BRANCH',
        placedAt: '2026-04-11T00:00:00.000Z'
      },
      branchState: { id: 'bs-1', branchNo: 1, shelfCodeRaw: 'B-02', updatedAt: '2026-04-11T00:00:00.000Z' }
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper });

    await act(async () => {
      await result.current.parseActualSlipImageFile(new File(['dummy'], 'slip.jpg', { type: 'image/jpeg' }));
    });

    expect(result.current.actualOrder).toBe('0002178005');
    expect(result.current.actualFseiban).toBe('BE1N9321');
    expect(result.current.actualSlipOcrFeedback.status).toBe('success');
    expect(result.current.actualSlipOcrFeedback.manufacturingOrder10).toBe('0002178005');
    expect(result.current.actualSlipOcrFeedback.ocrPreview).toContain('8440002178005');
  });
});
