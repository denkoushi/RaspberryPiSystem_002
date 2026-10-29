import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision } from '../../api/domains/assembly/check-sheets';

import { importedSheet, savedSheet } from './assembly-check-sheets/testFixtures';
import { AssemblyCheckSheetsPage } from './AssemblyCheckSheetsPage';

vi.mock('../../api/domains/assembly/check-sheets', () => ({
  importAssemblyCheckSheet: vi.fn(), listAssemblyCheckSheetRevisions: vi.fn(), saveAssemblyCheckSheetRevision: vi.fn()
}));
vi.mock('../../api/hooks/tools', () => ({
  useEmployees: () => ({ data: [{ id: '33333333-3333-4333-8333-333333333333', employeeCode: 'E01', displayName: '試験 太郎' }] })
}));

async function openProposal() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><AssemblyCheckSheetsPage /></QueryClientProvider>);
  await screen.findByText('TEST-01');
  const file = new File(['synthetic workbook'], 'test.xlsx');
  fireEvent.change(screen.getByLabelText('チェックシートファイル'), { target: { files: [file] } });
  await screen.findByRole('heading', { name: '取り込み内容' });
  expect(vi.mocked(importAssemblyCheckSheet).mock.calls[0][0]).toBe(file);
}

describe('AssemblyCheckSheetsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAssemblyCheckSheetRevisions).mockResolvedValue([savedSheet()]);
    vi.mocked(importAssemblyCheckSheet).mockResolvedValue(importedSheet());
    vi.mocked(saveAssemblyCheckSheetRevision).mockResolvedValue(savedSheet(2));
  });

  it('renders all proposal mappings and highlights only warning rows', async () => {
    await openProposal();
    expect(screen.getByLabelText('1-1 文言')).toHaveValue('締結トルク');
    expect(screen.getByLabelText('日付')).toHaveValue('D3');
    expect(screen.getByLabelText('1-1 条件文')).toHaveValue('モータ付きの場合');
    expect(screen.getByLabelText('1-1 押印セル')).toHaveValue('S10');
    expect(screen.getByLabelText('1-1 値セル')).toHaveValue('F10');
    expect(screen.getByLabelText('1-2 選択肢')).toHaveValue('有\n無');
    expect(screen.getByText('単位を確認').closest('tr')).toHaveClass('bg-amber-100');
    expect(screen.getByLabelText('1-2 文言').closest('tr')).not.toHaveClass('bg-amber-100');
    expect(screen.queryByLabelText('leader')).not.toBeInTheDocument();
  });

  it('saves an edited unit, headers and employee ids as a new sheet and returns to the refreshed list', async () => {
    await openProposal();
    fireEvent.change(screen.getByLabelText('1-1 torque 単位'), { target: { value: 'N·m' } });
    fireEvent.change(screen.getByLabelText('客先名'), { target: { value: 'K6' } });
    const picker = screen.getByLabelText('制御設計担当');
    const option = within(picker).getByRole('option') as HTMLOptionElement;
    option.selected = true;
    fireEvent.change(picker);
    vi.mocked(listAssemblyCheckSheetRevisions).mockResolvedValue([savedSheet(2)]);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveAssemblyCheckSheetRevision).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveAssemblyCheckSheetRevision).mock.calls[0][0];
    expect(payload.importId).toBe(importedSheet().importId);
    expect(payload).not.toHaveProperty('revisionRootId');
    expect(payload.proposal.items[0]).toEqual({ ...importedSheet().proposal.items[0], inputSpec: { fields: [{ key: 'torque', label: 'トルク', unit: 'N·m' }] } });
    expect(payload.proposal.headerCellMap).toEqual({ date: 'D3', customer: 'K6' });
    expect(payload.proposal.departmentRoleMembers).toEqual({ 制御設計担当: ['33333333-3333-4333-8333-333333333333'] });
    expect(await screen.findByRole('heading', { name: '版一覧' })).toBeInTheDocument();
    expect(await screen.findByText('2 / △1')).toBeInTheDocument();
    expect(listAssemblyCheckSheetRevisions).toHaveBeenCalledTimes(2);
  });

  it('adds/removes fields and excludes rows, then saves against the selected revision root', async () => {
    await openProposal();
    fireEvent.click(screen.getByRole('button', { name: '1-1 入力欄を追加' }));
    fireEvent.change(screen.getByLabelText('1-1 field1 ラベル'), { target: { value: '予備' } });
    fireEvent.click(screen.getByRole('button', { name: '1-1 torque 入力欄を削除' }));
    expect(screen.queryByLabelText('1-1 torque 単位')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1-2 対象外にする' }));
    fireEvent.change(screen.getByLabelText('保存方法'), { target: { value: 'revision' } });
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('改訂元シート'), { target: { value: savedSheet().revisionRootId } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveAssemblyCheckSheetRevision).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveAssemblyCheckSheetRevision).mock.calls[0][0];
    expect(payload.revisionRootId).toBe(savedSheet().revisionRootId);
    expect(payload.proposal.items).toHaveLength(1);
    expect(payload.proposal.items[0].inputSpec.fields).toEqual([{ key: 'field1', label: '予備', unit: '' }]);
  });

  it('retains edits and displays API validation details next to save', async () => {
    vi.mocked(saveAssemblyCheckSheetRevision).mockRejectedValue({ isAxiosError: true, response: { data: {
      message: 'リクエスト形式が不正です', issues: [{ path: ['proposal', 'items', 0, 'stampCell'], message: 'セル番地が不正です' }]
    } } });
    await openProposal();
    fireEvent.change(screen.getByLabelText('1-1 押印セル'), { target: { value: 'INVALID' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('proposal.items.0.stampCell: セル番地が不正です');
    expect(alert.closest('section')).toHaveTextContent('保存');
    expect(screen.getByLabelText('1-1 押印セル')).toHaveValue('INVALID');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('shows upload failures near the import control', async () => {
    vi.mocked(importAssemblyCheckSheet).mockRejectedValue(new Error('.xlsxファイルを指定してください'));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssemblyCheckSheetsPage /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('チェックシートファイル'), { target: { files: [new File(['bad'], 'bad.txt')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('.xlsxファイルを指定してください');
    expect(screen.getByRole('heading', { name: '版一覧' })).toBeInTheDocument();
  });
});
