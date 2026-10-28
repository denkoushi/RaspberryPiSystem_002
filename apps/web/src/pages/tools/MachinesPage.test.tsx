import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachinesPage } from './MachinesPage';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), resourceCd: '021' }));
vi.mock('../../api/hooks', () => ({
  useMachines: () => ({ data: [{ id: 'm1', equipmentManagementNumber: '10018', name: '加工機', resourceCd: mocks.resourceCd }], isLoading: false }),
  useMachineResourceChoices: () => ({ data: [{ resourceCd: '021', resourceName: '旋盤' }, { resourceCd: '022', resourceName: '研削盤' }] }),
  useMachineMutations: () => ({ create: { mutateAsync: mocks.create }, update: { mutateAsync: mocks.update }, remove: {} }),
}));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resourceCd = '021';
});

describe('MachinesPage resourceCd', () => {
  it.each([['022', '022'], ['', null]])('sends selected resourceCd %j on edit', async (selected, expected) => {
    render(<MachinesPage />);
    expect(within(screen.getByRole('table')).getByText('021')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '編集', exact: true }));
    const select = screen.getByRole('combobox', { name: '資源CD' });
    expect(select).toHaveValue('021');
    expect(within(select).getByRole('option', { name: '022 研削盤' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: selected } });
    fireEvent.click(screen.getByRole('button', { name: '上書き保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 'm1', payload: expect.objectContaining({ resourceCd: expected }) }));
  });

  it('retains a saved resourceCd that is absent from current choices', async () => {
    mocks.resourceCd = '099';
    render(<MachinesPage />);
    fireEvent.click(screen.getByRole('button', { name: '編集', exact: true }));
    expect(screen.getByRole('combobox', { name: '資源CD' })).toHaveValue('099');
    fireEvent.click(screen.getByRole('button', { name: '上書き保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 'm1', payload: expect.objectContaining({ resourceCd: '099' }) }));
  });

  it('sends resourceCd on creation', async () => {
    render(<MachinesPage />);
    fireEvent.change(screen.getByLabelText('設備管理番号'), { target: { value: '10019' } });
    fireEvent.change(screen.getByLabelText('加工機名称'), { target: { value: '新加工機' } });
    fireEvent.change(screen.getByRole('combobox', { name: '資源CD' }), { target: { value: '022' } });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ resourceCd: '022' })));
  });
});
