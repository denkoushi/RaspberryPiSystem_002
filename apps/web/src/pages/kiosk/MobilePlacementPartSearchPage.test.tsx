import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/search']}><Routes>
    <Route path="/search" element={<MobilePlacementPartSearchPage />} />
    <Route path="/kiosk/mobile-placement" element={<div>配膳ハブ</div>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMobilePlacementPartSearchSuggest).mockResolvedValue({ currentPlacements: [hit], scheduleCandidates: [] });
});

describe('MobilePlacementPartSearchPage phone flow', () => {
  it('keeps typing, expands/collapses details and clears the query and selection', async () => {
    mount();
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
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('配膳ハブ')).toBeInTheDocument();
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
