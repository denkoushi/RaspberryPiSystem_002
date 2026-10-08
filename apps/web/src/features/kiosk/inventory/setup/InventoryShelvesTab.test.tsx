import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryLocations, useInventoryMutations } from '../../../../api/hooks';

import { InventoryShelvesTab } from './InventoryShelvesTab';

vi.mock('../../../../api/hooks', () => ({
  useInventoryLocations: vi.fn(() => ({
    data: [{ id: 'shelf-1', area: '30041R_2MF-P', shelfNumber: 1, drawers: [] }, { id: 'shelf-2', area: '30041R_2MF-P', shelfNumber: 2, drawers: [] }],
  })),
  useInventoryImports: vi.fn(() => ({ data: [{ id: 'import-1', area: '50013_540AP' }] })),
  useInventoryMutations: vi.fn(),
}));

function mutation() {
  return { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
}

describe('InventoryShelvesTab', () => {
  let mutations: Record<string, ReturnType<typeof mutation>>;

  beforeEach(() => {
    vi.mocked(useInventoryLocations).mockReturnValue({ data: [{ id: 'shelf-1', area: '30041R_2MF-P', shelfNumber: 1, drawers: [] }, { id: 'shelf-2', area: '30041R_2MF-P', shelfNumber: 2, drawers: [] }] } as never);
    mutations = { createShelf: mutation(), createDrawer: mutation(), renameArea: mutation(), deleteShelf: mutation(), deleteDrawer: mutation() };
    vi.mocked(useInventoryMutations).mockReturnValue(mutations as never);
  });

  it('renames an area to machine + direction, defaulting to 北', async () => {
    render(<InventoryShelvesTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '名前を変える' }));
    expect(screen.getByLabelText('加工機')).toHaveValue('30041R_2MF-P');
    expect(screen.getByRole('button', { name: '北' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('30041R_2MF-P 北')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '名前を変える' }).at(-1)!); });

    expect(mutations.renameArea.mutateAsync).toHaveBeenCalledWith({ from: '30041R_2MF-P', to: '30041R_2MF-P 北' });
  });

  it('creates a new area from a candidate machine and a direction', async () => {
    render(<InventoryShelvesTab accessPassword="2520" />);

    fireEvent.click(screen.getByRole('button', { name: '＋ 新しいエリア' }));
    fireEvent.click(screen.getByRole('button', { name: '50013_540AP' }));
    fireEvent.click(screen.getByRole('button', { name: '東' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1を作る' })); });

    expect(mutations.createShelf.mutateAsync).toHaveBeenCalledWith({ area: '50013_540AP 東', shelfNumber: 1 });
  });
  it('deletes a shelf without drawers and recreates its area and number on undo', async () => {
    render(<InventoryShelvesTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚2を削除' })); });
    expect(mutations.deleteShelf.mutateAsync).toHaveBeenCalledWith('shelf-2');
    expect(screen.queryByRole('region', { name: '棚2' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(mutations.createShelf.mutateAsync).toHaveBeenCalledWith({ area: '30041R_2MF-P', shelfNumber: 2 });
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('deletes only an empty drawer and recreates its shelf and number on undo', async () => {
    vi.mocked(useInventoryLocations).mockReturnValue({ data: [{ id: 'shelf-1', area: '機械 北', shelfNumber: 1, drawers: [
      { id: 'd1', drawerNumber: 1, compartments: [{ item: { name: '中身' } }] },
      { id: 'd2', drawerNumber: 2, compartments: [] },
    ] }] } as never);
    render(<InventoryShelvesTab accessPassword="2520" />);
    expect(screen.getByRole('button', { name: '棚1を削除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '棚1の引き出し1を削除' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1の引き出し2を削除' })); });
    expect(mutations.deleteDrawer.mutateAsync).toHaveBeenCalledWith('d2');
    expect(mutations.deleteShelf.mutateAsync).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(mutations.createDrawer.mutateAsync).toHaveBeenCalledWith({ shelfId: 'shelf-1', drawerNumber: 2 });
  });

  it('keeps a failed deletion in place and reports the API conflict beside it', async () => {
    mutations.deleteShelf.mutateAsync.mockRejectedValue({ response: { data: { errorCode: 'SHELF_NOT_EMPTY', message: '引き出しがあります' } } });
    render(<InventoryShelvesTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1を削除' })); });
    expect(within(screen.getByRole('region', { name: '棚1' })).getByRole('alert')).toHaveTextContent('引き出しがあります');
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('keeps undo available if recreation fails', async () => {
    mutations.createShelf.mutateAsync.mockRejectedValue({ response: { data: { code: 'DUPLICATE', message: '同じ棚があります' } } });
    render(<InventoryShelvesTab accessPassword="2520" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '棚1を削除' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('同じ棚があります');
    expect(screen.getByRole('button', { name: '元に戻す' }).parentElement).toContainElement(screen.getByRole('alert'));
  });

});
