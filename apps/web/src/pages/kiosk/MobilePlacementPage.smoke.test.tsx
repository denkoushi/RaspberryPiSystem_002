import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MobilePlacementPage } from './MobilePlacementPage';

const noop = vi.fn();

vi.mock('../../features/mobile-placement/useRegisteredShelves', () => ({
  useRegisteredShelves: () => ({
    data: { shelves: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn()
  })
}));

vi.mock('../../features/mobile-placement/useOrderPlacementBranches', () => ({
  useOrderPlacementBranches: () => ({
    data: { branches: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn()
  })
}));

vi.mock('../../features/mobile-placement/useMobilePlacementPageState', () => ({
  useMobilePlacementPageState: () => ({
    transferOrder: '',
    setTransferOrder: noop,
    transferPart: '',
    setTransferPart: noop,
    actualOrder: '',
    setActualOrder: noop,
    actualFseiban: '',
    setActualFseiban: noop,
    actualPart: '',
    setActualPart: noop,
    slipResult: 'idle' as const,
    resetSlipResult: noop,
    buildShelfRegisterRouteState: () => ({}),
    restoreShelfRegisterRouteState: noop,
    slipVerifying: false,
    runSlipVerify: noop,
    shelfCode: '',
    selectShelf: noop,
    orderBarcode: '',
    setOrderBarcode: noop,
    registerSubmitting: false,
    registerMessage: null,
    registerError: null,
    registerDisabled: true,
    orderPlacementIntent: 'create_new_branch' as const,
    setOrderPlacementIntent: noop,
    selectedBranchId: null,
    setSelectedBranchId: noop,
    runRegister: noop,
    scanField: null,
    setScanField: noop,
    scanFormats: [],
    onScanSuccess: noop,
    parseActualSlipImageFile: noop,
    actualSlipImageOcrBusy: false,
    actualSlipOcrFeedback: {
      status: 'idle',
      manufacturingOrder10: null,
      fseiban: null,
      ocrPreview: null,
      message: null,
      errorDetail: null
    },
    resetActualSlipOcrFeedback: noop
  })
}));

describe('MobilePlacementPage', () => {
  it('メインでは Zero2W 配膳パネルを出さず、一覧への導線だけを出す', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/kiosk/mobile-placement']}>
          <Routes>
            <Route path="/kiosk/mobile-placement" element={<MobilePlacementPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.queryByRole('region', { name: 'Zero2W 棚番配膳の状態' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚番配膳一覧（Zero2W）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚マスタ' })).toBeInTheDocument();
  });
});
