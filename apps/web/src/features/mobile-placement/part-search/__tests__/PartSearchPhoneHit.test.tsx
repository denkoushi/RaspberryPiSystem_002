import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteOrderPlacementBranch } from '../../../../api/domains/mobile-placement';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';
import { PartSearchPhoneHit } from '../PartSearchPhoneHit';

import type { PartPlacementSearchHitDto } from '../types';

vi.mock('../../../../api/domains/mobile-placement', () => ({ deleteOrderPlacementBranch: vi.fn() }));
const hit: PartPlacementSearchHitDto = {
  matchSource: 'current', displayName: '脚', matchedQuery: '脚', aliasMatchedBy: null,
  shelfCodeRaw: 'A-1', manufacturingOrderBarcodeRaw: null, branchNo: 1, branchStateId: 'branch-1',
  csvDashboardRowId: null, fhincd: '123', fhinmei: null, fseiban: null, productNo: null
};
function mount(selected = true, item = hit) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const onDeleted = vi.fn();
  const view = (expanded: boolean) => <QueryClientProvider client={client}>
    <PartSearchPhoneHit hit={item} selected={expanded} onSelect={vi.fn()} onDeleted={onDeleted} />
  </QueryClientProvider>;
  const result = render(view(selected));
  return { ...result, onDeleted, invalidate, select: (expanded: boolean) => result.rerender(view(expanded)) };
}
beforeEach(() => vi.resetAllMocks());

describe('PartSearchPhoneHit deletion', () => {
  it('hides deletion when collapsed or for a schedule candidate', () => {
    const current = mount(false);
    expect(screen.queryByRole('button', { name: 'この品物を消す' })).not.toBeInTheDocument();
    current.unmount();
    mount(true, { ...hit, matchSource: 'schedule', branchStateId: null });
    expect(screen.queryByRole('button', { name: 'この品物を消す' })).not.toBeInTheDocument();
  });

  it('confirms, disables both controls while busy, invalidates prefixes and reports success', async () => {
    let resolveDelete!: (value: Awaited<ReturnType<typeof deleteOrderPlacementBranch>>) => void;
    vi.mocked(deleteOrderPlacementBranch).mockImplementation(() => new Promise(resolve => { resolveDelete = resolve; }));
    const { container, onDeleted, invalidate } = mount();
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await waitFor(() => expect(deleteOrderPlacementBranch).toHaveBeenCalledWith('branch-1', expect.anything()));
    expect(screen.getByRole('button', { name: '本当に消す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled();
    resolveDelete({ deleted: { id: 'branch-1', manufacturingOrderBarcodeRaw: '', branchNo: 1, shelfCodeRaw: 'A-1' } });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    for (const queryKey of [mobilePlacementQueryKeys.partSearchAll, mobilePlacementQueryKeys.orderPlacementBranchesAll, ['mobile-placement', 'haizen-overview']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('cancels without deletion and resets confirmation after collapsing', () => {
    const { select } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getByRole('button', { name: 'この品物を消す' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
    select(false);
    select(true);
    expect(screen.getByRole('button', { name: 'この品物を消す' })).toBeInTheDocument();
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
  });

  it('shows the server error and returns to the normal state', async () => {
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue({ isAxiosError: true, response: { data: { message: 'この品物はもうありません' } } });
    const { onDeleted } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'この品物を消す' }));
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('この品物はもうありません');
    expect(screen.getByRole('button', { name: 'この品物を消す' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'やめる' })).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
