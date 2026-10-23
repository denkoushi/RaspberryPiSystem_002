import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobilePlacementPage } from './MobilePlacementPage';

const noop = vi.fn();
const restoreShelfRegisterRouteState = vi.fn();

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
    restoreShelfRegisterRouteState,
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

function Destination() {
  return <div>{useLocation().pathname}</div>;
}

function renderPage(state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/kiosk/mobile-placement', state }]}>
        <Routes>
          <Route path="/kiosk/mobile-placement" element={<MobilePlacementPage />} />
          <Route path="*" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('MobilePlacementPage', () => {
  it('メインでは Zero2W 配膳パネルを出さず、メニューに一覧への導線を出す', () => {
    renderPage();
    expect(screen.queryByRole('region', { name: 'Zero2W 棚番配膳の状態' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zero2W 配膳' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '移動票を読む' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(screen.getByRole('dialog', { name: 'ほかの画面' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zero2W 配膳' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚マスタ' })).toBeInTheDocument();
  });

  it.each([
    ['パレット', '/kiosk/mobile-placement/pallet-viz'],
    ['Zero2W 配膳', '/kiosk/mobile-placement/zero2w-status'],
    ['棚マスタ', '/kiosk/mobile-placement/shelf-master']
  ])('%s のメニューで正しいルートを開く', (label, path) => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    expect(screen.getByText(path)).toBeInTheDocument();
  });

  it.each([
    ['部品', '/kiosk/mobile-placement/part-search'],
    ['購買', '/kiosk/purchase-order-lookup']
  ])('%s タブで正しいルートを開く', (label, path) => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: label }));
    expect(screen.getByText(path)).toBeInTheDocument();
  });

  it('購買・部品からの state でメニューを一度開く', () => {
    renderPage({ openHaizenMenu: true });
    expect(screen.getByRole('dialog', { name: 'ほかの画面' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(restoreShelfRegisterRouteState).not.toHaveBeenCalled();
  });

  it('棚マスタから戻った state を一度復元する', () => {
    const state = { transferOrder: 'T1', transferPart: 'P1', actualOrder: 'A1', actualFseiban: 'F1', actualPart: 'P1', slipResult: 'ok', shelfCode: '西-北-02', orderBarcode: 'T1', openHaizenMenu: true };
    renderPage(state);
    expect(restoreShelfRegisterRouteState).toHaveBeenCalledExactlyOnceWith(state);
    expect(screen.getByRole('dialog', { name: 'ほかの画面' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(restoreShelfRegisterRouteState).toHaveBeenCalledExactlyOnceWith(state);
  });

  it('写真入力の既存OCR処理へファイルを渡す', () => {
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['image'], 'slip.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(noop).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
    expect(input).toHaveAttribute('capture', 'environment');
  });
});
