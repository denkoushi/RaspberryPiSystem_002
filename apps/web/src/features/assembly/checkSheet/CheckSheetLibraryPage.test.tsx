import { assemblyCheckSheetSaveSchema } from '@raspi-system/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissAssemblyCheckSheetGmailImport, getAssemblyCheckSheetGmailImport, listAssemblyCheckSheetGmailImports, importAssemblyCheckSheet, listAssemblyCheckSheetRevisions, saveAssemblyCheckSheetRevision } from '../../../api/domains/assembly/check-sheets';
import { getKioskEmployees } from '../../../api/domains/kiosk';


import { CheckSheetLibraryPage } from './CheckSheetLibraryPage';
import { importedSheet, savedSheet } from './testFixtures';

vi.mock('../../../api/domains/assembly/check-sheets', () => ({
  dismissAssemblyCheckSheetGmailImport: vi.fn(), getAssemblyCheckSheetGmailImport: vi.fn(), listAssemblyCheckSheetGmailImports: vi.fn(),
  importAssemblyCheckSheet: vi.fn(), listAssemblyCheckSheetRevisions: vi.fn(), saveAssemblyCheckSheetRevision: vi.fn()
}));
vi.mock('../../../api/domains/kiosk', () => ({ getKioskEmployees: vi.fn() }));

async function openProposal() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
  await screen.findByText('TEST-01');
  const file = new File(['synthetic workbook'], 'test.xlsx');
  fireEvent.change(screen.getByLabelText('チェックシートファイル'), { target: { files: [file] } });
  await screen.findByRole('heading', { name: 'test.xlsx' });
  expect(vi.mocked(importAssemblyCheckSheet).mock.calls[0][0]).toBe(file);
}

describe('CheckSheetLibraryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [] });
    vi.mocked(getAssemblyCheckSheetGmailImport).mockResolvedValue(importedSheet());
    vi.mocked(dismissAssemblyCheckSheetGmailImport).mockResolvedValue({ importId: importedSheet().importId });
    vi.mocked(getKioskEmployees).mockResolvedValue([{ id: '33333333-3333-4333-8333-333333333333', displayName: '試験 太郎', department: '制御設計' }]);
    vi.mocked(listAssemblyCheckSheetRevisions).mockResolvedValue([savedSheet()]);
    vi.mocked(importAssemblyCheckSheet).mockResolvedValue(importedSheet());
    vi.mocked(saveAssemblyCheckSheetRevision).mockResolvedValue(savedSheet(2));
  });

  it('opens a Gmail import in the existing review form and refreshes the list after saving', async () => {
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [{ importId: importedSheet().importId, originalFileName: 'mail.xlsx', receivedAt: '2026-10-29T01:00:00.000Z' }] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
    const row = await screen.findByRole('button', { name: /mail.xlsx/ });
    const at = new Date('2026-10-29T01:00:00.000Z');
    expect(row).toHaveTextContent(`10/29 ${String(at.getHours()).padStart(2, '0')}:00`);
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { name: 'mail.xlsx' })).toBeInTheDocument();
    expect(getAssemblyCheckSheetGmailImport).toHaveBeenCalledExactlyOnceWith(importedSheet().importId);
    expect(importAssemblyCheckSheet).not.toHaveBeenCalled();
    expect(screen.getByLabelText('1-1 文言')).toHaveValue('締結トルク');
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('heading', { name: '保存済み' });
    await waitFor(() => expect(listAssemblyCheckSheetGmailImports).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /mail.xlsx/ })).not.toBeInTheDocument();
    expect(vi.mocked(saveAssemblyCheckSheetRevision).mock.calls[0][0].importId).toBe(importedSheet().importId);
  });

  it('dismisses a Gmail import and removes it after refetching', async () => {
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [{ importId: importedSheet().importId, originalFileName: 'mail.xlsx', receivedAt: '2026-10-29T01:00:00.000Z' }] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
    await screen.findByRole('button', { name: /mail.xlsx/ });
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: '対象外' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /mail.xlsx/ })).not.toBeInTheDocument());
    expect(dismissAssemblyCheckSheetGmailImport).toHaveBeenCalledWith(importedSheet().importId, expect.anything());
    expect(listAssemblyCheckSheetGmailImports).toHaveBeenCalledTimes(2);
  });

  it('keeps the Gmail import visible when opening or dismissal fails', async () => {
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [{ importId: importedSheet().importId, originalFileName: 'mail.xlsx', receivedAt: null }] });
    vi.mocked(getAssemblyCheckSheetGmailImport).mockRejectedValue(new Error('読み取り失敗'));
    vi.mocked(dismissAssemblyCheckSheetGmailImport).mockRejectedValue(new Error('対象外処理失敗'));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'mail.xlsx' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('読み取り失敗');
    expect(screen.getByRole('heading', { name: '保存済み' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '対象外' }));
    await waitFor(() => expect(dismissAssemblyCheckSheetGmailImport).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'mail.xlsx' })).toBeInTheDocument();
  });

  it('renders selected proposal mappings and highlights only warning items', async () => {
    await openProposal();
    expect(screen.getByLabelText('1-1 文言')).toHaveValue('締結トルク');
    expect(screen.getByLabelText('1-1 条件文')).toHaveValue('モータ付きの場合');
    expect(screen.getByLabelText('1-1 押印セル')).toHaveValue('S10');
    expect(screen.getByLabelText('1-1 値セル')).toHaveValue('F10');
    const rows = screen.getAllByTestId('check-sheet-item');
    expect(rows[0]).toHaveClass('!bg-amber-950');
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveClass('!bg-amber-950');
    fireEvent.click(rows[1]);
    expect(screen.getByLabelText('1-2 選択肢')).toHaveValue('有\n無');
    expect(screen.queryByLabelText('1-1 文言')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '記入セル' }));
    expect(screen.getByLabelText('日付')).toHaveValue('D3');
    expect(screen.queryByLabelText('leader')).not.toBeInTheDocument();
  });

  it('saves an edited unit, headers and employee ids as a new sheet and returns to the refreshed list', async () => {
    await openProposal();
    fireEvent.change(screen.getByLabelText('1-1 torque 単位'), { target: { value: 'N·m' } });
    fireEvent.click(screen.getByRole('button', { name: '新規' }));
    fireEvent.click(screen.getByRole('tab', { name: '記入セル' }));
    fireEvent.change(screen.getByLabelText('客先名'), { target: { value: 'K6' } });
    expect(getKioskEmployees).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: '担当者' }));
    const picker = screen.getByRole('group', { name: '制御設計担当' });
    fireEvent.click(await within(picker).findByRole('button', { name: '試験 太郎' }));
    vi.mocked(listAssemblyCheckSheetRevisions).mockResolvedValue([savedSheet(2)]);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveAssemblyCheckSheetRevision).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveAssemblyCheckSheetRevision).mock.calls[0][0];
    expect(payload.importId).toBe(importedSheet().importId);
    expect(payload).not.toHaveProperty('revisionRootId');
    expect(payload.proposal.items[0]).toEqual({ ...importedSheet().proposal.items[0], inputSpec: { fields: [{ key: 'torque', label: 'トルク', unit: 'N·m' }] } });
    expect(payload.proposal.headerCellMap).toEqual({ date: 'D3', customer: 'K6' });
    expect(payload.proposal.departmentRoleMembers).toEqual({ 制御設計担当: ['33333333-3333-4333-8333-333333333333'] });
    expect(await screen.findByRole('heading', { name: '保存済み' })).toBeInTheDocument();
    expect(await screen.findByText('2 / △1')).toBeInTheDocument();
    expect(listAssemblyCheckSheetRevisions).toHaveBeenCalledTimes(2);
  });

  it('adds/removes fields and excludes rows, then saves against the selected revision root', async () => {
    await openProposal();
    fireEvent.click(screen.getByRole('button', { name: '1-1 入力欄を追加' }));
    fireEvent.change(screen.getByLabelText('1-1 field1 ラベル'), { target: { value: '予備' } });
    fireEvent.click(screen.getByRole('button', { name: '1-1 torque 入力欄を削除' }));
    expect(screen.queryByLabelText('1-1 torque 単位')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('check-sheet-item')[1]);
    fireEvent.click(screen.getByRole('button', { name: '1-2 対象外にする' }));
    expect(screen.getByLabelText('1-1 文言')).toHaveValue('締結トルク');
    expect(screen.getByRole('button', { name: '改訂' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('改訂元シート'), { target: { value: '' } });
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

  it('displays the empty department role returned by the save schema', async () => {
    const payload = { importId: importedSheet().importId, proposal: importedSheet().proposal };
    payload.proposal.departmentRoleMembers = {};
    const parsed = assemblyCheckSheetSaveSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected missing members');
    vi.mocked(saveAssemblyCheckSheetRevision).mockRejectedValue({ isAxiosError: true, response: { data: {
      message: 'リクエスト形式が不正です', issues: parsed.error.issues
    } } });
    await openProposal();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('部署役割「制御設計担当」の社員を1人以上選択してください');
  });

  it('waits for saved revisions before allowing an import to open', async () => {
    let complete!: (value: ReturnType<typeof savedSheet>[]) => void;
    vi.mocked(listAssemblyCheckSheetRevisions).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    vi.mocked(listAssemblyCheckSheetGmailImports).mockResolvedValue({ items: [{ importId: importedSheet().importId, originalFileName: 'mail.xlsx', receivedAt: null }] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
    const row = await screen.findByRole('button', { name: 'mail.xlsx' });
    expect(row).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ファイルから取り込み' })).toBeDisabled();
    complete([savedSheet()]);
    await waitFor(() => expect(row).toBeEnabled());
    fireEvent.click(row);
    expect(await screen.findByRole('button', { name: '改訂' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('改訂元シート')).toHaveValue(savedSheet().revisionRootId);
  });

  it('selects matching revisions automatically and preserves input kind and role edits in the payload', async () => {
    await openProposal();
    expect(screen.getByRole('button', { name: '改訂' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('改訂元シート')).toHaveValue(savedSheet().revisionRootId);
    fireEvent.click(screen.getByRole('button', { name: '文字', exact: true }));
    expect(screen.getByRole('button', { name: '文字', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const roles = screen.getByRole('group', { name: '1-1 担当' });
    fireEvent.click(within(roles).getByRole('button', { name: '制御設計担当' }));
    expect(within(roles).getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveAssemblyCheckSheetRevision).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveAssemblyCheckSheetRevision).mock.calls[0][0];
    expect(payload.revisionRootId).toBe(savedSheet().revisionRootId);
    expect(payload.proposal.items[0].inputKind).toBe('TEXT');
    expect(payload.proposal.items[0].roleKeys).toEqual(['leader']);
  });

  it('starts new documents at the first item, navigates warnings and cancels back to the empty inbox', async () => {
    const draft = importedSheet();
    draft.proposal.documentNo = 'NEW-01';
    draft.proposal.items[0].warnings = [];
    vi.mocked(importAssemblyCheckSheet).mockResolvedValue(draft);
    await openProposal();
    expect(screen.getByRole('button', { name: '新規' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('改訂元シート')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('check-sheet-item')[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(await screen.findByText('届いたシートはありません')).toBeInTheDocument();
  });

  it('opens at the first warning and wraps through warning items', async () => {
    const draft = importedSheet();
    draft.proposal.items[0].warnings = [];
    draft.proposal.items[1].warnings = ['確認してください'];
    vi.mocked(importAssemblyCheckSheet).mockResolvedValue(draft);
    await openProposal();
    expect(screen.getAllByTestId('check-sheet-item')[1]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getAllByTestId('check-sheet-item')[0]);
    fireEvent.click(screen.getByRole('button', { name: '次の要確認へ' }));
    expect(screen.getByLabelText('1-2 文言')).toHaveValue('外観');
    fireEvent.click(screen.getByRole('button', { name: '次の要確認へ' }));
    expect(screen.getByRole('tab', { name: '項目 1-2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('disables editing and cancellation while saving', async () => {
    let complete!: (value: ReturnType<typeof savedSheet>) => void;
    vi.mocked(saveAssemblyCheckSheetRevision).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await openProposal();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled();
    expect(screen.getByLabelText('1-1 文言')).toBeDisabled();
    complete(savedSheet(2));
    expect(await screen.findByRole('heading', { name: '保存済み' })).toBeInTheDocument();
  });

  it('shows upload failures near the import control', async () => {
    vi.mocked(importAssemblyCheckSheet).mockRejectedValue(new Error('.xlsxファイルを指定してください'));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckSheetLibraryPage /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('チェックシートファイル'), { target: { files: [new File(['bad'], 'bad.txt')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('.xlsxファイルを指定してください');
    expect(screen.getByRole('heading', { name: '保存済み' })).toBeInTheDocument();
  });
});
