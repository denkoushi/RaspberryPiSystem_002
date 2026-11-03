import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveInventoryMachineOrder } from '../../../api/client';

import { InventoryMachinePicker } from './InventoryMachinePicker';

vi.mock('../../../api/client', () => ({ saveInventoryMachineOrder: vi.fn() }));
const machines = [
  { id: 'a', name: 'A', shortName: null, equipmentManagementNumber: '1' },
  { id: 'b', name: 'B', shortName: null, equipmentManagementNumber: '2' },
];
afterEach(() => vi.restoreAllMocks());
describe('InventoryMachinePicker', () => {
  it.each([false, true])('saves pointer reordering and restores on failure=%s', async fail => {
    const onError = vi.fn();
    const onSelect = vi.fn();
    vi.mocked(saveInventoryMachineOrder).mockReset();
    if (fail) vi.mocked(saveInventoryMachineOrder).mockRejectedValue(new Error('保存失敗'));
    else vi.mocked(saveInventoryMachineOrder).mockResolvedValue(undefined);
    function Driver() {
      const [editing, setEditing] = useState(false);
      const [shownMachines, setShownMachines] = useState(machines);
      return <><button onClick={() => setShownMachines([{ ...machines[0], name: '更新名' }, { ...machines[1], id: 'c', name: '追加' }, { ...machines[1], id: 'd', name: '追加2' }])}>一覧更新</button><InventoryMachinePicker machines={shownMachines} selectedId={null} editing={editing} onEditing={setEditing} onSelect={onSelect} nudge={false} disabled={false} onError={onError} onOrderSaved={setShownMachines} /></>;
    }
    render(<Driver />);
    fireEvent.click(screen.getByRole('button', { name: '並び順を変える' }));
    const a = screen.getByRole('button', { name: 'A', exact: true });
    const b = screen.getByRole('button', { name: 'B', exact: true });
    fireEvent.click(a);
    expect(onSelect).not.toHaveBeenCalled();
    Object.defineProperty(a.parentElement, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => b), configurable: true });
    // jsdom has no PointerEvent constructor.
    const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperties(down, { isPrimary: { value: true }, pointerId: { value: 1 } });
    fireEvent(a, down);
    fireEvent.pointerMove(a, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(a);
    await waitFor(() => expect(saveInventoryMachineOrder).toHaveBeenCalledWith(['b', 'a']));
    const group = screen.getByRole('group', { name: '使う加工機' });
    await waitFor(() => expect(within(group).getAllByRole('button')[0]).toHaveTextContent(fail ? 'A' : 'B'));
    if (fail) expect(onError).toHaveBeenCalled();
    {
      fireEvent.click(screen.getByRole('button', { name: '一覧更新' }));
      expect(within(group).getAllByRole('button')).toHaveLength(3);
      expect(within(group).getByRole('button', { name: '更新名' })).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: '追加', exact: true })).toBeInTheDocument();
      expect(within(group).queryByRole('button', { name: 'B', exact: true })).not.toBeInTheDocument();
    }
  });
});
