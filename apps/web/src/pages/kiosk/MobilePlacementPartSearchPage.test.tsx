import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementPartSearchSuggest } from '../../api/client';

import { MobilePlacementPartSearchPage } from './MobilePlacementPartSearchPage';

import type { PartPlacementSearchHitDto } from '../../features/mobile-placement/part-search/types';

vi.mock('../../api/client', () => ({ getMobilePlacementPartSearchSuggest: vi.fn() }));

const hit: PartPlacementSearchHitDto = {
  matchSource: 'current', displayName: '脚（左）', matchedQuery: '脚', aliasMatchedBy: null,
  shelfCodeRaw: '西-北-02', manufacturingOrderBarcodeRaw: '0002178005', branchNo: 2,
  branchStateId: 'branch-1', csvDashboardRowId: 'row-1', fhincd: 'MD00412163',
  fhinmei: '脚（左）', fseiban: 'BA1S2201', productNo: '100'
};

function Destination() {
  const location = useLocation();
  return <div>配膳ハブ<output aria-label="遷移">{useNavigationType()} {location.pathname} {location.state?.openHaizenMenu ? 'メニュー' : ''}</output></div>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/search']}><Routes>
    <Route path="/search" element={<MobilePlacementPartSearchPage />} />
    <Route path="*" element={<Destination />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMobilePlacementPartSearchSuggest).mockResolvedValue({ currentPlacements: [hit], scheduleCandidates: [] });
});

describe('MobilePlacementPartSearchPage phone flow', () => {
  it.each([
    ['照合', '/kiosk/mobile-placement', 'verify'],
    ['配膳', '/kiosk/mobile-placement', 'place'],
    ['購買', '/kiosk/purchase-order-lookup', null]
  ])('%s タブは履歴を置換する', (tab, path, stored) => {
    mount();
    expect(screen.getByRole('tab', { name: '部品' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent(`REPLACE ${path}`);
    if (stored) expect(localStorage.getItem('haizen-tab')).toBe(stored);
  });

  it('メニューを開く state を付けてハブへ置換する', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'ほかの画面' }));
    expect(screen.getByLabelText('遷移')).toHaveTextContent('REPLACE /kiosk/mobile-placement メニュー');
  });

  it('keeps typing, expands/collapses details and clears the query and selection', async () => {
    mount();
    expect(screen.getByRole('tab', { name: '部品' })).toHaveAttribute('aria-selected', 'true');
    const input = screen.getByRole('textbox', { name: '部品名・品番' });
    fireEvent.change(input, { target: { value: '脚' } });
    const result = await screen.findByRole('button', { name: /西-北-02/ });
    expect(screen.queryByText('0002178005')).not.toBeInTheDocument();
    fireEvent.click(result);
    expect(screen.getByText('0002178005')).toBeInTheDocument();
    fireEvent.click(result);
    expect(result).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(result);
    fireEvent.click(screen.getByRole('button', { name: '全部消す' }));
    expect(input).toHaveValue('');
    expect(screen.queryByText('0002178005')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '全部消す' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配膳' }));
    expect(screen.getByText('配膳ハブ')).toBeInTheDocument();
    expect(localStorage.getItem('haizen-tab')).toBe('place');
  });

  it('applies the existing machine AND query through chips; all machines clears only that filter', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: '部品名・品番' }), { target: { value: 'MD' } });
    fireEvent.click(screen.getByRole('button', { name: '機種指定' }));
    fireEvent.change(screen.getByRole('textbox', { name: '機種名' }), { target: { value: 'DAD3350' } });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    await waitFor(() => expect(getMobilePlacementPartSearchSuggest).toHaveBeenLastCalledWith('MD', 'DAD3350'));
    expect(screen.getByRole('button', { name: 'DAD3350' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '全機種' }));
    expect(screen.getByRole('textbox', { name: '部品名・品番' })).toHaveValue('MD');
    expect(screen.getByRole('button', { name: '全機種' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'DAD3350' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'DAD3350' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '全部消す' }));
    await waitFor(() => expect(getMobilePlacementPartSearchSuggest).toHaveBeenLastCalledWith('', 'DAD3350'));
    expect(screen.getByRole('button', { name: 'DAD3350' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses presets, keyboard modes and backspace without a native keyboard', async () => {
    mount();
    const bottom = screen.getByRole('contentinfo');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(bottom.previousElementSibling).toContainElement(screen.getByLabelText('文字キー'));
    expect(bottom).toContainElement(screen.getByRole('button', { name: '1文字消す' }));
    const input = screen.getByRole('textbox', { name: '部品名・品番' });
    fireEvent.click(screen.getByRole('button', { name: '脚', exact: true }));
    expect(input).toHaveValue('脚');
    await screen.findByRole('button', { name: /西-北-02/ });
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '英数' }));
    fireEvent.click(screen.getByRole('button', { name: 'A', exact: true }));
    expect(input).toHaveValue('A');
    expect(within(screen.getByRole('group', { name: '文字種' })).getByRole('button', { name: '英数' })).toHaveAttribute('aria-pressed', 'true');
  });
});
