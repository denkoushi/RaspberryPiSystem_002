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
  it.each([['0004099556', ''], ['0002178005', 'STALE']])('scanning order %s leaves transfer part %j', (order, part) => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    act(() => {
      result.current.setTransferOrder('0002178005');
      result.current.setTransferPart('STALE');
      result.current.setActualPart('ACTUAL');
      result.current.setScanField('transferOrder');
    });
    act(() => result.current.onScanSuccess(` ${order} `));
    expect(result.current.transferOrder).toBe(order);
    expect(result.current.transferPart).toBe(part);
    expect(result.current.actualPart).toBe('ACTUAL');
    expect(result.current.scanField).toBeNull();
  });

  it.each(['MD004883240', ' MD000006755-002 ', 'md004883240'])('routes an alphabetic transfer scan to the part field: %j', (part) => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    act(() => {
      result.current.setTransferOrder('0002178005');
      result.current.setTransferPart('STALE');
      result.current.setScanField('transferOrder');
    });
    act(() => result.current.onScanSuccess(part));
    expect(result.current.transferOrder).toBe('0002178005');
    expect(result.current.transferPart).toBe(part.trim());
    expect(result.current.scanField).toBeNull();
  });

  it('keeps a part code scanned before the first transfer order', () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    act(() => result.current.setScanField('transferOrder'));
    act(() => result.current.onScanSuccess('MD004883240'));
    act(() => result.current.setScanField('transferOrder'));
    act(() => result.current.onScanSuccess('0004099556'));
    expect(result.current.transferOrder).toBe('0004099556');
    expect(result.current.transferPart).toBe('MD004883240');
  });

  it('preserves the transfer part when restoring navigation state', () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    act(() => result.current.restoreShelfRegisterRouteState({
      transferOrder: '0004099556', transferPart: 'MD004883240', actualOrder: '4501238876', actualPart: 'MD004883240',
      actualFseiban: '', slipResult: 'ok', shelfCode: 'A-01', orderBarcode: '0004099556'
    }));
    expect(result.current.transferOrder).toBe('0004099556');
    expect(result.current.transferPart).toBe('MD004883240');
    expect(result.current.slipResult).toBe('ok');
  });

  it.each(['create_new_branch', 'move_existing'] as const)('uses 分配なし in %s feedback', async (intent) => {
    vi.mocked(registerOrderPlacement).mockResolvedValue({ event: { id: 'event' }, branchState: { branchNo: 0 } } as never);
    vi.mocked(moveOrderPlacementBranch).mockResolvedValue({ event: { id: 'event' }, branchState: { branchNo: 0, shelfCodeRaw: 'B' } } as never);
    const qc = new QueryClient();
    const { result } = renderHook(() => useMobilePlacementPageState(), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) });
    act(() => {
      result.current.setOrderBarcode('100'); result.current.selectShelf('B');
    });
    act(() => { result.current.setOrderPlacementIntent(intent); result.current.setSelectedBranchId('branch'); });
    await act(async () => { await result.current.runRegister(); });
    expect(result.current.registerMessage).toContain('分配なし');
  });
  it('parseActualSlipImage の製造orderと製番を状態に反映する', async () => {
    vi.mocked(parseActualSlipImage).mockResolvedValue({
      engine: 'stub',
      fseibanRaw: '8E1N9321',
      fseibanMatch: 'corrected',
      fseibanCandidates: ['BE1N9321'],
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

    act(() => result.current.setTransferOrder('0002178005'));
    await act(async () => {
      await result.current.parseActualSlipImageFile(new File(['dummy'], 'slip.jpg', { type: 'image/jpeg' }));
    });

    expect(parseActualSlipImage).toHaveBeenCalledWith(expect.any(File));
    expect(result.current.actualSlipOcrFeedback.fseibanCandidates).toEqual(['BE1N9321']);
    expect(result.current.actualOrder).toBe('0002178005');
    expect(result.current.actualFseiban).toBe('BE1N9321');
    expect(result.current.actualSlipOcrFeedback.status).toBe('success');
    expect(result.current.actualSlipOcrFeedback.manufacturingOrder10).toBe('0002178005');
    expect(result.current.actualSlipOcrFeedback.ocrPreview).toContain('8440002178005');
  });
});
