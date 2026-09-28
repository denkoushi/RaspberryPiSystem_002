import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryMutations } from '../../../../api/hooks';

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
    mutations = { createShelf: mutation(), createDrawer: mutation(), renameArea: mutation() };
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
});
