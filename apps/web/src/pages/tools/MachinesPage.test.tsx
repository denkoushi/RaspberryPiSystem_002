import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachinesPage } from './MachinesPage';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), resourceCd: '021', addTag: vi.fn(), removeTag: vi.fn(), siteKey: 'mishima', nfcEvent: null as unknown }));
vi.mock('../../api/hooks', () => ({
  useSites: () => ({ data: [{ key: 'mishima', displayName: '三島工場' }, { key: 'sendai', displayName: '仙台工場' }] }),
  useMachines: () => ({ data: [{ id: 'm1', equipmentManagementNumber: '10018', name: '加工機', resourceCd: mocks.resourceCd, siteKey: mocks.siteKey, site: { key: 'mishima', displayName: '三島工場' }, nfcTags: [{ id: 'tag1', uid: 'UID-1' }] }], isLoading: false }),
  useMachineResourceChoices: () => ({ data: [{ resourceCd: '021', addTag: vi.fn(), removeTag: vi.fn(), siteKey: 'mishima', nfcEvent: null as unknown, resourceName: '旋盤' }, { resourceCd: '022', resourceName: '研削盤' }] }),
  useMachineMutations: () => ({ create: { mutateAsync: mocks.create }, update: { mutateAsync: mocks.update }, remove: {}, addTag: { mutateAsync: mocks.addTag }, removeTag: { mutateAsync: mocks.removeTag } }),
}));
vi.mock('../../hooks/useNfcStream', () => ({ useNfcStream: () => mocks.nfcEvent }));
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

describe('machine sites and NFC tags', () => {
  it('shows site and tags and sends the selected site on edit', async () => {
    render(<MachinesPage />);
    expect(within(screen.getByRole('table')).getByText('三島工場')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'NFCタグ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '編集', exact: true }));
    expect(screen.getByRole('combobox', { name: '工場' })).toHaveValue('mishima');
    fireEvent.change(screen.getByRole('combobox', { name: '工場' }), { target: { value: 'sendai' } });
    fireEvent.click(screen.getByRole('button', { name: '上書き保存' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ id: 'm1', payload: expect.objectContaining({ siteKey: 'sendai' }) }));
  });
  it('adds and removes a tag', async () => {
    render(<MachinesPage />);
    fireEvent.click(screen.getByRole('button', { name: '加工機のタグを追加' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'UID' }), { target: { value: 'UID-2' } });
    fireEvent.click(screen.getByRole('button', { name: '追加', exact: true }));
    await waitFor(() => expect(mocks.addTag).toHaveBeenCalledWith({ machineId: 'm1', uid: 'UID-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'UID-1を外す' }));
    await waitFor(() => expect(mocks.removeTag).toHaveBeenCalledWith({ machineId: 'm1', tagId: 'tag1' }));
  });
  it('ignores an old NFC event and fills UID from a newly armed read', async () => {
    mocks.nfcEvent = { uid: 'OLD', eventId: 'old', timestamp: 'old' };
    const view = render(<MachinesPage />);
    fireEvent.click(screen.getByRole('button', { name: '加工機のタグを追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'NFCを読み取る' }));
    expect(screen.getByRole('textbox', { name: 'UID' })).toHaveValue('');
    mocks.nfcEvent = { uid: 'NEW', eventId: 'new', timestamp: 'new' };
    view.rerender(<MachinesPage />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'UID' })).toHaveValue('NEW'));
    expect(screen.getByRole('button', { name: 'NFCを読み取る' })).toBeInTheDocument();
    mocks.nfcEvent = null;
  });
  it('shows the API conflict message', async () => {
    mocks.addTag.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { message: 'このUIDは使用済みです' } } });
    render(<MachinesPage />);
    fireEvent.click(screen.getByRole('button', { name: '加工機のタグを追加' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'UID' }), { target: { value: 'USED' } });
    fireEvent.click(screen.getByRole('button', { name: '追加', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('このUIDは使用済みです');
  });
});
