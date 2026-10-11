import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardWedgeScan } from '../../barcode-scan/useKeyboardWedgeScan';

import { ProcedureManualReattachPartDialog } from './ProcedureManualReattachPartDialog';

import type { ProcedureManualAssignmentDto, ProcedureManualAssignmentOverviewItemDto, ProcedureManualProcessDto } from '../types';

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), detail: vi.fn(), replace: vi.fn(), rename: vi.fn() }));
vi.mock('../../../api/client', () => ({ listProcedureManualPartCandidates: mocks.candidates, getProcedureManualAssignments: mocks.detail,
  replaceProcedureManualAssignments: mocks.replace, renameAssemblyProcedureDocument: mocks.rename }));

const processes: ProcedureManualProcessDto[] = [
  { id: 'machining', parentId: null, name: '加工工程', subjectKind: 'MODEL', active: true, sortOrder: 0, resourceCd: null },
  { id: 'grinding', parentId: 'machining', name: '研削工程', subjectKind: 'PART', active: true, sortOrder: 0, resourceCd: null }
];
const item: ProcedureManualAssignmentOverviewItemDto = {
  assignmentId: 'old', modelCode: ' ｄｆｄ１ ', modelCodeKey: 'DFD1', processId: 'grinding', documentId: 'draft',
  title: 'DFD1_加工_研削', label: '表示名', kind: 'assembly_procedure_document', status: 'draft', sortOrder: 1,
  publishedRevisionNumber: null, approval: null, draftRevision: null, unavailableReason: null, pageCount: 1, thumbnailPageUrl: null, otherAssignments: []
};
const assignment = (id: string, assemblyProcedureDocumentId: string | null, sortOrder: number, label: string | null, kioskDocumentId: string | null = null): ProcedureManualAssignmentDto => ({
  id, assemblyProcedureDocumentId, kioskDocumentId, sortOrder, label, modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'grinding', resolvedDocumentId: null, unavailableReason: 'no_published_revision'
});
const oldRows = [assignment('first', 'other-root', 0, '他の手順'), assignment('old', 'draft', 1, '表示名'), assignment('disabled', null, 2, '無効PDF', 'pdf')];
const targetRows = [assignment('target-first', 'target-root', 0, '先頭'), assignment('target-pdf', null, 1, 'PDF', 'target-pdf')];
const inputs = (rows: ProcedureManualAssignmentDto[]) => rows.map(({ assemblyProcedureDocumentId, kioskDocumentId, label }, sortOrder) => ({ assemblyProcedureDocumentId, kioskDocumentId, label, sortOrder }));

function show(overrides: Partial<Parameters<typeof ProcedureManualReattachPartDialog>[0]> = {}) {
  const props = { item, processes, beforeMutation: vi.fn(() => true), onClose: vi.fn(), onSaved: vi.fn(), onChanged: vi.fn(), ...overrides };
  const view = render(<ProcedureManualReattachPartDialog {...props} />);
  return { ...view, props };
}
const dialog = () => within(screen.getByRole('dialog', { name: '部品を付け直す' }));
const scan = (text: string) => { for (const key of text) fireEvent.keyDown(window, { key }); fireEvent.keyDown(window, { key: 'Enter' }); };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidates.mockResolvedValue([
    { partNumber: 'DFD1', partNumberKey: 'DFD1', partName: '現在の品名', hasManual: true },
    { partNumber: ' ｐａｒｔ－① ', partNumberKey: ' ｐａｒｔ－① ', partName: ' 主_軸 ', hasManual: false },
    { partNumber: 'PART-2', partNumberKey: 'PART-2', partName: null, hasManual: false }
  ]);
  mocks.detail.mockImplementation(async (key: string) => ({ assignments: key === 'DFD1' ? oldRows : targetRows }));
  mocks.replace.mockResolvedValue(undefined); mocks.rename.mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());

describe('reattach a draft to a part', () => {
  it.each([true, false])('adds before removing, preserves other entries and labels, and optionally renames (rename=%s)', async rename => {
    const { props } = show();
    expect(dialog().getByRole('button', { name: '付け直す' })).toBeDisabled();
    expect(dialog().getByRole('checkbox', { name: '名前も変える' })).toBeChecked();
    expect(dialog().getByText('部品を選ぶ').parentElement).toHaveClass('border-dashed');
    const pick = await dialog().findByRole('button', { name: 'ｐａｒｔ－①' });
    expect(dialog().queryByRole('button', { name: 'DFD1' })).not.toBeInTheDocument();
    expect(dialog().getByText('現在の品名')).toBeInTheDocument();
    expect(pick).toHaveTextContent('主_軸');
    expect(within(pick).getByText('ｐａｒｔ－①')).toHaveClass('text-sm');
    fireEvent.click(pick);
    expect(dialog().getByLabelText('名前のプレビュー')).toHaveTextContent('主 軸_PART-1_加工_研削');
    if (!rename) fireEvent.click(dialog().getByRole('checkbox', { name: '名前も変える' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('PART-1', 'grinding', '付け直しました'));
    expect(mocks.replace).toHaveBeenNthCalledWith(1, 'PART-1', 'grinding', {
      modelCode: 'PART-1', assignments: [...inputs(targetRows), { assemblyProcedureDocumentId: 'draft', kioskDocumentId: null, label: '表示名', sortOrder: 2 }]
    });
    expect(mocks.replace).toHaveBeenNthCalledWith(2, 'DFD1', 'grinding', { modelCode: ' ｄｆｄ１ ', assignments: inputs([oldRows[0], oldRows[2]]) });
    expect(mocks.detail.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.replace.mock.invocationCallOrder[0]);
    if (rename) {
      expect(mocks.rename).toHaveBeenCalledExactlyOnceWith('draft', '主 軸_PART-1_加工_研削');
      expect(mocks.rename.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.replace.mock.invocationCallOrder[1]);
    } else expect(mocks.rename).not.toHaveBeenCalled();
  });

  it('skips addition when the draft is already assigned to the target', async () => {
    mocks.detail.mockImplementation(async (key: string) => ({ assignments: key === 'DFD1' ? oldRows : [...targetRows, assignment('already', 'draft', 2, '既存の表示名')] }));
    const { props } = show();
    fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    expect(dialog().getByLabelText('名前のプレビュー')).toHaveTextContent('PART-2_加工_研削');
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('DFD1', 'grinding', { modelCode: item.modelCode, assignments: inputs([oldRows[0], oldRows[2]]) });
    expect(mocks.rename).toHaveBeenCalledWith('draft', 'PART-2_加工_研削');
  });

  it('keeps the added target assignment and reports a failed removal without renaming', async () => {
    let savedTarget: unknown;
    mocks.replace.mockImplementation(async (key: string, _process: string, body: unknown) => {
      if (key === 'DFD1') throw new Error('元を外せません');
      savedTarget = body;
    });
    const { props } = show();
    fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('元を外せません。新しい部品への割り当ては残っています');
    expect(savedTarget).toMatchObject({ assignments: expect.arrayContaining([expect.objectContaining({ assemblyProcedureDocumentId: 'draft' })]) });
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(mocks.rename).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onChanged).toHaveBeenCalledOnce();
  });

  it('guards a changed old assignment and retains the added target', async () => {
    mocks.detail.mockImplementation(async (key: string) => ({ assignments: key === 'DFD1' ? oldRows.filter(row => row.id !== 'old') : targetRows }));
    const { props } = show();
    fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('割り当てが更新されました。もう一度確認してください。新しい部品への割り当ては残っています');
    expect(mocks.replace).toHaveBeenCalledTimes(1); expect(mocks.rename).not.toHaveBeenCalled();
    expect(props.onChanged).toHaveBeenCalledOnce();
  });

  it('does not remove if addition fails', async () => {
    mocks.replace.mockRejectedValue(new Error('追加できません'));
    show(); fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('追加できません');
    expect(mocks.detail).toHaveBeenCalledTimes(1); expect(mocks.replace).toHaveBeenCalledTimes(1); expect(mocks.rename).not.toHaveBeenCalled();
  });

  it('reports a rename failure after the move and selects the target', async () => {
    mocks.rename.mockRejectedValue(new Error('名前を変更できません'));
    const { props } = show(); fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('PART-2', 'grinding', '付け直しました。名前を変更できません'));
  });

  it('does not mutate if access expired or the dialog is cancelled', async () => {
    const { props } = show({ beforeMutation: vi.fn(() => false) });
    fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    expect(mocks.detail).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'やめる' }));
    expect(props.onClose).toHaveBeenCalledOnce(); expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('blocks duplicate confirmation, cancellation and picking while busy', async () => {
    let finish!: () => void;
    mocks.replace.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const { props } = show();
    fireEvent.click(await dialog().findByRole('button', { name: 'PART-2' }));
    fireEvent.click(dialog().getByRole('button', { name: '付け直す' }));
    expect(dialog().getByRole('button', { name: '付け直す' })).toBeDisabled();
    expect(dialog().getByRole('button', { name: 'やめる' })).toBeDisabled();
    expect(dialog().getByRole('button', { name: 'PART-2' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(mocks.replace).toHaveBeenCalledTimes(2);
  });

  it('uses the shared tenkey and ignores stale search responses', async () => {
    let resolve!: (rows: unknown[]) => void;
    mocks.candidates.mockImplementation(({ digitQuery }: { digitQuery: string }) => digitQuery === '1' ? new Promise(done => { resolve = done; }) : Promise.resolve([]));
    show();
    const keys = within(dialog().getByRole('group', { name: '部品テンキー' }));
    fireEvent.click(keys.getByRole('button', { name: '1' }));
    expect(mocks.candidates).toHaveBeenLastCalledWith({ digitQuery: '1', q: '', limit: 30 });
    fireEvent.click(keys.getByRole('button', { name: '2' }));
    expect(mocks.candidates).toHaveBeenLastCalledWith({ digitQuery: '12', q: '', limit: 30 });
    await act(async () => resolve([{ partNumberKey: 'STALE', partNumber: 'STALE', partName: null, hasManual: false }]));
    expect(dialog().queryByRole('button', { name: 'STALE' })).not.toBeInTheDocument();
    fireEvent.click(keys.getByRole('button', { name: 'C' }));
    expect(mocks.candidates).toHaveBeenLastCalledWith({ digitQuery: '', q: '', limit: 30 });
  });

  it.each([true, false])('selects a normalized scan and looks up its name (known=%s)', async known => {
    mocks.candidates.mockImplementation(async ({ q }: { q: string }) => known && q === 'PART-1' ? [{ partNumber: 'PART-1', partNumberKey: 'PART-1', partName: '主軸', hasManual: false }] : []);
    show();
    fireEvent.click(dialog().getByRole('button', { name: '移動票をスキャン' }));
    scan('ｐａｒｔ－①');
    await waitFor(() => expect(dialog().getByRole('button', { name: '付け直す' })).toBeEnabled());
    expect(mocks.candidates).toHaveBeenLastCalledWith({ digitQuery: '', q: 'PART-1', limit: 30 });
    expect(dialog().getByLabelText('名前のプレビュー')).toHaveTextContent(`${known ? '主軸_' : ''}PART-1_加工_研削`);
    scan('OTHER-2');
    expect(dialog().getByLabelText('名前のプレビュー')).toHaveTextContent('PART-1');
  });

  it('owns the scanner even when unarmed and releases it on close', async () => {
    const onBackgroundScan = vi.fn();
    function Background() { useKeyboardWedgeScan({ active: true, onScan: onBackgroundScan }); return null; }
    const view = render(<><Background /><ProcedureManualReattachPartDialog item={item} processes={processes} beforeMutation={() => true} onClose={vi.fn()} onSaved={vi.fn()} onChanged={vi.fn()} /></>);
    scan('UNARMED-1');
    expect(onBackgroundScan).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: '移動票をスキャン' })); scan('DFD1');
    await waitFor(() => expect(mocks.candidates).toHaveBeenLastCalledWith({ digitQuery: '', q: 'DFD1', limit: 30 }));
    expect(dialog().getByRole('button', { name: '付け直す' })).toBeDisabled();
    expect(onBackgroundScan).not.toHaveBeenCalled();
    view.rerender(<Background />); scan('AFTER-1');
    expect(onBackgroundScan).toHaveBeenCalledExactlyOnceWith('AFTER-1');
  });
});
