import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../api/client';
import { ShelfMasterPageContent } from '../ShelfMasterPageContent';

vi.mock('../../../../api/client', () => ({
  getMobilePlacementShelfMachines: vi.fn(),
  getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
  putMobilePlacementHaizenTargetPresetShelf: vi.fn(), getMobilePlacementHaizenTargetDevices: vi.fn(),
}));
const routeState = { transferOrder: '1234567890', transferPart: 'PART', actualOrder: '1234567890', actualFseiban: 'S', actualPart: 'PART', slipResult: 'ok', shelfCode: '西-北-01', orderBarcode: '1234567890' };
function Hub() { const location = useLocation(); return <pre data-testid="hub-state">{JSON.stringify(location.state)}</pre>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: '/master', state: routeState }]}><Routes>
    <Route path="/master" element={<ShelfMasterPageContent />} /><Route path="/kiosk/mobile-placement" element={<Hub />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['M1'], landmarks: ['電気室'] });
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [] });
  vi.mocked(api.getMobilePlacementHaizenTargetDevices).mockResolvedValue({ devices: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('photo-only shelf master', () => {
  it.each([390, 1440])('shows the photo master at width %i without mode buttons', async (width) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: width < 768, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    mount();
    expect(screen.getByRole('heading', { name: '棚マスタ' })).toBeInTheDocument();
    if (width < 768) await screen.findByRole('button', { name: '棚を追加' });
    else expect(await screen.findByTestId('shelf-master-kiosk')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚を移す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '配置を変える' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再割当' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'レイアウト', exact: true })).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('mobile-placement-shelf-machines-v1')).toBe(JSON.stringify({ machines: ['M1'], landmarks: ['電気室'] })));
    expect(localStorage.getItem('mobile-placement-registered-shelves-v1')).toBe(JSON.stringify({ shelves: [] }));
  });

  it('returns to the haizen hub with the hand-off state', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    mount();
    await screen.findByRole('button', { name: '棚を追加' });
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(JSON.parse(screen.getByTestId('hub-state').textContent!)).toEqual(routeState);
  });
});
