import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getHaizenMaterialArrival, getHaizenMaterialView, getHaizenOverview, getHaizenUnplacedParts, getMobilePlacementRegisteredShelves } from '../../api/domains/mobile-placement';
import { SCHEDULE_SOURCE_STORAGE_KEY } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardScheduleSource';

import { KioskHaizenMaterialPage, PICKED_SEIBANS_STORAGE_KEY } from './KioskHaizenMaterialPage';

import type { HaizenMaterialArrivalItem } from '../../api/domains/mobile-placement';

vi.mock('../../api/domains/mobile-placement', () => ({ getHaizenMaterialArrival: vi.fn(), getHaizenMaterialView: vi.fn(), getHaizenOverview: vi.fn(), getHaizenUnplacedParts: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn() }));
const base = { verified: false, dueDate: null, sendOutDate: null, source: 'branch' as const, manufacturingOrderBarcodeRaw: '123', fseiban: 'BA1', fhincd: 'K1', fhinmei: 'ブラケット', machineName: null, branchNo: 1 };
const rows = [
  { ...base, id: '1', shelfCodeRaw: '西-北-01', dueDate: '2026-11-10', fhinmei: '後の部品', updatedAt: '2026-10-21T01:00:00Z', fseiban: 'LATE' },
  { ...base, id: '2', shelfCodeRaw: '西-北-02', dueDate: '2026-11-07', fhinmei: '先の部品', updatedAt: '2026-10-22T01:00:00Z', verified: true },
  { ...base, id: '3', shelfCodeRaw: '西-北-02', fhincd: 'K2', fhinmei: '二つ目の部品', updatedAt: '2026-10-23T01:00:00Z', verified: true },
  { ...base, id: '4', shelfCodeRaw: '西-北-01', fhincd: 'K3', fhinmei: '三つ目の部品', updatedAt: '2026-10-24T01:00:00Z', verified: true }
];
const part = { fseiban: 'BA1', productNo: '100', fhincd: 'UP1', fhinmei: '未配置部品', verified: false, machineName: 'ｒｖ－１２ａ', dueDate: '2026-11-07' };
const arrival: HaizenMaterialArrivalItem = { fseiban: 'BA1', fhincd: 'K1', status: 'ordered', basis: 'material' };
let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/materials']}><Routes>
    <Route path="/materials" element={<KioskHaizenMaterialPage />} />
    <Route path="/kiosk/inventory/haizen" element={<p>配膳の場所の画面</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(getHaizenOverview).mockResolvedValue({ rows, truncated: false });
  vi.mocked(getHaizenUnplacedParts).mockResolvedValue([part]);
  vi.mocked(getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [{ shelfCodeRaw: '西-北-02', displayLabel: '棚名2', isStructured: true }, { shelfCodeRaw: '西-北-01', displayLabel: '棚名1', isStructured: true }] });
  vi.mocked(getHaizenMaterialArrival).mockResolvedValue({ items: [arrival, { ...arrival, fhincd: 'K2', status: 'partial' }, { ...arrival, fhincd: 'K3', status: 'unordered' }] });
  vi.mocked(getHaizenMaterialView).mockImplementation(async source => ({
    seibanOrder: ['LATE', 'BA1'], excludedFseibans: source === 'general' ? ['LATE'] : source === 'dCompany' ? ['BA1'] : []
  }));
});
afterEach(() => { cleanup(); client.clear(); });

describe('KioskHaizenMaterialPage', () => {
  it('starts collapsed in board order with normalized machine, due date and progress, and opens the selected shelf', async () => {
    mount();
    const heading = await screen.findByRole('button', { name: /BA1 RV-12A 納期 11\/7\(土\) 照合 3\/4 配膳 3\/4/ });
    const late = screen.getByRole('button', { name: /LATE/ });
    await waitFor(() => expect(late.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(late).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const chips = await screen.findAllByRole('button', { name: /点$/ });
    expect(chips.map(chip => chip.getAttribute('aria-label'))).toEqual(['棚 西-北-01 棚名1 1点', '棚 西-北-01 棚名1 1点', '棚 西-北-02 棚名2 2点']);
    expect(screen.getByText('未配置 1')).toBeInTheDocument();
    expect(await screen.findByText('材料未入荷 1')).toBeInTheDocument();
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('未配置部品')).toBeInTheDocument();
    expect(screen.queryByText('後の部品')).not.toBeInTheDocument();
    fireEvent.click(heading);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(heading);
    fireEvent.click((await screen.findAllByRole('button', { name: '棚 西-北-02 棚名2' }))[0]);
    await screen.findByText('配膳の場所の画面');
  });
  it('waits for unplaced parts so progress is not overstated, then fills badges without waiting for the shelf master', async () => {
    let resolveUnplaced!: (parts: typeof part[]) => void;
    let resolveMaterial!: (result: { items: HaizenMaterialArrivalItem[] }) => void;
    vi.mocked(getMobilePlacementRegisteredShelves).mockReturnValue(new Promise(() => {}));
    vi.mocked(getHaizenUnplacedParts).mockReturnValue(new Promise(resolve => { resolveUnplaced = resolve; }));
    vi.mocked(getHaizenMaterialArrival).mockReturnValue(new Promise(resolve => { resolveMaterial = resolve; }));
    mount();
    await screen.findByText('配膳情報を読み込んでいます…');
    expect(screen.queryByRole('button', { name: /BA1/ })).not.toBeInTheDocument();
    expect(getHaizenMaterialArrival).not.toHaveBeenCalled();
    resolveUnplaced([part]);
    const heading = await screen.findByRole('button', { name: /BA1/ });
    fireEvent.click(heading);
    expect(screen.getAllByRole('button', { name: '棚 西-北-02 西-北-02' })).toHaveLength(2);
    expect(screen.getByText('未配置部品')).toBeInTheDocument();
    expect(screen.queryByText('材料未入荷')).not.toBeInTheDocument();
    expect(screen.queryByText('材料未入荷 1')).not.toBeInTheDocument();
    await waitFor(() => expect(getHaizenMaterialArrival).toHaveBeenCalledTimes(1));
    expect(getHaizenMaterialArrival).toHaveBeenCalledWith(expect.arrayContaining([{ fseiban: 'BA1', fhincd: 'K1' }]));
    resolveMaterial({ items: [arrival] });
    await screen.findByText('材料未入荷');
    expect(screen.getByText('材料未入荷 1')).toBeInTheDocument();
  });
  it('switches all three sources and restores the kiosk selection without changing the board storage', async () => {
    const savedBoardSource = JSON.stringify({ schemaVersion: 1, scheduleSource: 'general' });
    window.localStorage.setItem(SCHEDULE_SOURCE_STORAGE_KEY, savedBoardSource);
    const { unmount } = mount();
    expect(screen.getByRole('button', { name: '両方', pressed: true })).toBeInTheDocument();
    await screen.findByRole('button', { name: /LATE/ });
    fireEvent.click(screen.getByRole('button', { name: '一般' }));
    expect(screen.getByRole('button', { name: '一般', pressed: true })).toBeInTheDocument();
    await screen.findByRole('button', { name: /BA1/ });
    expect(screen.queryByRole('button', { name: /LATE/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'D社' }));
    await screen.findByRole('button', { name: /LATE/ });
    expect(screen.queryByRole('button', { name: /BA1/ })).not.toBeInTheDocument();
    expect(vi.mocked(getHaizenMaterialView).mock.calls).toEqual([['both'], ['general'], ['dCompany']]);
    unmount();
    client.clear();
    mount();
    expect(screen.getByRole('button', { name: 'D社', pressed: true })).toBeInTheDocument();
    expect(window.localStorage.getItem(SCHEDULE_SOURCE_STORAGE_KEY)).toBe(savedBoardSource);
    fireEvent.click(screen.getByRole('button', { name: '両方' }));
    await screen.findByRole('button', { name: /BA1/ });
    expect(screen.getByRole('button', { name: /LATE/ })).toBeInTheDocument();
  });
  it('moves checked seibans above the board order and keeps them on this terminal', async () => {
    const before = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const { unmount } = mount();
    await waitFor(() => expect(before(screen.getByRole('button', { name: /LATE/ }), screen.getByRole('button', { name: /BA1/ }))).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'BA1' }));
    expect(screen.getByRole('checkbox', { name: 'BA1' })).toBeChecked();
    expect(before(screen.getByRole('button', { name: /BA1/ }), screen.getByRole('button', { name: /LATE/ }))).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(PICKED_SEIBANS_STORAGE_KEY) ?? 'null')).toEqual({ schemaVersion: 1, fseibans: ['BA1'] });
    unmount();
    client.clear();
    mount();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'BA1' })).toBeChecked());
    expect(before(screen.getByRole('button', { name: /BA1/ }), screen.getByRole('button', { name: /LATE/ }))).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'BA1' }));
    expect(before(screen.getByRole('button', { name: /LATE/ }), screen.getByRole('button', { name: /BA1/ }))).toBe(true);
  });
  it('opens a shelf from the collapsed row without expanding it', async () => {
    mount();
    const heading = await screen.findByRole('button', { name: /BA1/ });
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-02 棚名2 2点' }));
    await screen.findByText('配膳の場所の画面');
    expect(heading).not.toBeInTheDocument();
  });
  it('keeps the table when the material lookup fails', async () => {
    vi.mocked(getHaizenMaterialArrival).mockRejectedValue(new Error('boom'));
    mount();
    await screen.findByText('材料の入荷状況を取得できません。');
    fireEvent.click(screen.getByRole('button', { name: /BA1/ }));
    expect(screen.getByText('先の部品')).toBeInTheDocument();
    expect(screen.queryByText('材料未入荷')).not.toBeInTheDocument();
  });
});
