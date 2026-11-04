import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePalletVisualizationController } from '../usePalletVisualizationController';

const mocks = vi.hoisted(() => ({ submit: vi.fn(), remove: vi.fn(), clear: vi.fn(), records: [] as Array<{ status: string; machineCd: string; palletNo: number }> }));
vi.mock('../offline/usePalletOfflineQueue', () => ({ usePalletOfflineQueue: () => ({ submit: mocks.submit, records: mocks.records, message: '未送信 1 件' }) }));
vi.mock('../../../barcode-scan/useKeyboardWedgeScan', () => ({ useKeyboardWedgeScan: vi.fn() }));
vi.mock('../../../barcode-scan/useSerialBarcodeStream', () => ({ useSerialBarcodeStream: vi.fn() }));
vi.mock('../../../../api/client', () => ({
  getResolvedClientKey: () => 'key',
  getKioskPalletVisualizationBoard: async () => ({ machines: [{ machineCd: 'MC', palletCount: 2, pallets: [{ palletNo: 1, items: [] }, { palletNo: 2, items: [] }] }] }),
  deleteKioskPalletVisualizationItem: mocks.remove,
  clearKioskPalletVisualizationPallet: mocks.clear,
}));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => usePalletVisualizationController({ enableKeyboardWedge: false, enableSerialBarcodeStream: false }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}
beforeEach(() => { vi.clearAllMocks(); mocks.records = []; localStorage.clear(); });
it('queues add and replacement with the selected pallet and never a raw scan eventId', async () => {
  const { result } = mount();
  await waitFor(() => expect(result.current.selectedMachineCd).toBe('MC'));
  act(() => result.current.applyBarcode(' ORDER '));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ route: 'add', machineCd: 'MC', palletNo: 1, clientKey: 'key', body: { machineCd: 'MC', palletNo: 1, manufacturingOrderBarcodeRaw: 'ORDER' } }));
  act(() => result.current.setSelectedItemId('item'));
  act(() => result.current.applyBarcode('REPLACE'));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ route: 'replace', machineCd: 'MC', palletNo: 1, clientKey: 'key', itemId: 'item', body: { manufacturingOrderBarcodeRaw: 'REPLACE' } }));
});
it('blocks destructive actions only for a pallet with pending requests', async () => {
  mocks.records = [{ status: 'pending', machineCd: 'MC', palletNo: 1 }];
  const { result } = mount();
  await waitFor(() => expect(result.current.hasPendingRequests).toBe(true));
  act(() => result.current.setSelectedItemId('item'));
  act(() => { result.current.deleteSelectedItem(); result.current.clearCurrentPallet(); });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(result.current.offlineMessage).toBe('未送信 1 件');
  act(() => result.current.setPalletNo(2));
  expect(result.current.hasPendingRequests).toBe(false);
});
