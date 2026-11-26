import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getHaizenMaterialArrival, getHaizenOverview, getHaizenUnplacedParts, getMobilePlacementRegisteredShelves } from '../../api/domains/mobile-placement';

import { KioskHaizenMaterialPage } from './KioskHaizenMaterialPage';

vi.mock('../../api/domains/mobile-placement', () => ({ getHaizenMaterialArrival: vi.fn(), getHaizenOverview: vi.fn(), getHaizenUnplacedParts: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn() }));
const base = { verified: false, dueDate: null, sendOutDate: null, source: 'branch' as const, manufacturingOrderBarcodeRaw: '123', fseiban: 'BA1', fhincd: 'K1', fhinmei: 'ブラケット', machineName: null, branchNo: 1 };
const rows = [
  { ...base, id: '1', shelfCodeRaw: '西-北-01', dueDate: '2026-11-10', fhinmei: '後の部品', updatedAt: '2026-10-21T01:00:00Z', fseiban: 'LATE' },
  { ...base, id: '2', shelfCodeRaw: '西-北-02', dueDate: '2026-11-07', fhinmei: '先の部品', updatedAt: '2026-10-22T01:00:00Z' }
];
const part = { fseiban: 'BA1', productNo: '100', fhincd: 'UP1', fhinmei: '未配置部品', verified: false, machineName: null, dueDate: '2026-11-07' };
let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/materials']}><Routes>
    <Route path="/materials" element={<KioskHaizenMaterialPage />} />
    <Route path="/kiosk/inventory/haizen" element={<p>配膳の場所の画面</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: false });
  vi.mocked(getHaizenUnplacedParts).mockResolvedValue([part]);
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [{ shelfCodeRaw: '西-北-02', displayLabel: '棚名2', isStructured: true }, { shelfCodeRaw: '西-北-01', displayLabel: '棚名1', isStructured: true }] });
  vi.mocked(getHaizenMaterialArrival).mockResolvedValue({ items: [{ fseiban: 'BA1', fhincd: 'K1', status: 'ordered', basis: 'material' }] });
});
afterEach(() => { cleanup(); client.clear(); });

describe('KioskHaizenMaterialPage', () => {
  it('lists placed and unplaced parts by due date and shows the material badge', async () => {
    mount();
    await screen.findByText('未配置部品');
    const bodyRows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(bodyRows.map(row => within(row).getAllByRole('cell')[3].textContent)).toEqual(['未配置部品', '先の部品', '後の部品']);
    await waitFor(() => expect(within(bodyRows[1]).getByText('材料未入荷')).toBeInTheDocument());
    expect(getHaizenMaterialArrival).toHaveBeenCalledWith(expect.arrayContaining([{ fseiban: 'BA1', fhincd: 'K1' }]));
    fireEvent.click(bodyRows[1]);
    await screen.findByText('配膳の場所の画面');
  });
  it('keeps the table when the material lookup fails', async () => {
    vi.mocked(getHaizenMaterialArrival).mockRejectedValue(new Error('boom'));
    mount();
    await screen.findByText('材料の入荷状況を取得できません。');
    expect(screen.getByText('先の部品')).toBeInTheDocument();
    expect(screen.queryByText('材料未入荷')).not.toBeInTheDocument();
  });
});
