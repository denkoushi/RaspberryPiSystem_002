import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

import { ProcedureManualBrowser } from './ProcedureManualBrowser';
import { ProcedureManualCommonDialog } from './ProcedureManualCommonDialog';
import { ProcedureManualWorkshop } from './ProcedureManualWorkshop';

import type { ProcedureManualAssignmentOverviewItemDto, ProcedureManualCommonCatalogDto, ProcedureManualProcessDto } from '../types';

const api = vi.hoisted(() => ({ catalog: vi.fn(), overview: vi.fn(), create: vi.fn(), save: vi.fn(), delete: vi.fn(), assignments: vi.fn(), replace: vi.fn(), deleteDocument: vi.fn(), document: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureManualCommon: api.catalog, getProcedureManualOverview: api.overview,
  createProcedureManualCommon: api.create, saveProcedureManualCommonChoice: api.save, deleteProcedureManualCommonChoice: api.delete,
  listProcedureManualProcesses: async () => processes,
  listProcedureManualModels: async () => [], listProcedureManualParts: async () => [],
  listProcedureManualPartCandidates: async () => [], listAssemblyMachineNameCandidates: async () => ({ candidates: [] }),
  listProcedureMaterials: async () => [], listProcedureVideos: async () => [],
  getProcedureManualAssignments: api.assignments, replaceProcedureManualAssignments: api.replace,
  deleteAssemblyProcedureDocument: api.deleteDocument, getAssemblyProcedureDocument: api.document,
}));
vi.mock('../../../hooks/useProtectedImageBlobUrl', () => ({ useProtectedImageBlobUrl: () => ({ blobUrl: null }) }));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({ AssemblyProcedureSequenceViewer: () => <div>共通ビューア</div> }));
const processes: ProcedureManualProcessDto[] = [
  { id: 'tools', parentId: 'procedure-manual-common', name: '工具', subjectKind: 'COMMON', sortOrder: 0, active: true, resourceCd: null },
  { id: 'clean', parentId: 'procedure-manual-common', name: '清掃', subjectKind: 'COMMON', sortOrder: 1, active: true, resourceCd: null },
  { id: 'assembly', parentId: 'model-parent', name: '組立', subjectKind: 'MODEL', sortOrder: 0, active: true, resourceCd: null },
];
const catalog: ProcedureManualCommonCatalogDto = {
  categories: processes.filter(row => row.subjectKind === 'COMMON').map(row => ({ ...row, count: 1, inUse: row.id === 'tools' })),
  actions: [{ id: 'use', name: '使い方', sortOrder: 0, inUse: true }, { id: 'calibrate', name: '校正', sortOrder: 1, inUse: false }],
  subjects: [{ key: 'トルクレンチ', name: 'トルクレンチ', kanaRow: 'た', categoryIds: ['tools'] }],
};
function item(id: string, target: string, categoryId: string, kanaRow: string, status: 'published' | 'draft' = 'published'): ProcedureManualAssignmentOverviewItemDto {
  return { assignmentId: id, documentId: id, modelCode: target, modelCodeKey: target, processId: categoryId, subjectKind: 'COMMON', target, category: categoryId === 'tools' ? '工具' : '清掃', kanaRow, label: '使い方', title: `${target}_使い方`, kind: 'assembly_procedure_document', status, otherAssignments: [], sortOrder: 0, pageCount: 1, thumbnailPageUrl: null, publishedRevisionNumber: status === 'published' ? 1 : null, draftRevision: null, approval: null, unavailableReason: null };
}
const items = [item('torque', 'トルクレンチ', 'tools', 'た'), item('micrometer', 'マイクロメータ', 'tools', 'ま', 'draft'), item('machine', '研削盤', 'clean', 'か')];
function Location() { const location = useLocation(); return <output data-testid="location">{JSON.stringify(location)}</output>; }
function showWorkshop(query = '?common=1') { return render(<MemoryRouter initialEntries={[`/kiosk/assembly/manuals/workshop${query}`]}><ProcedureManualWorkshop /><Location /></MemoryRouter>); }
const onChanged = vi.fn(); const onFix = vi.fn();
function showDialog(categoryId = 'tools') { return render(<MemoryRouter><ProcedureManualCommonDialog catalog={catalog} items={items} categoryId={categoryId} onClose={vi.fn()} onChanged={onChanged} onFix={onFix} beforeMutation={() => true} /><Location /></MemoryRouter>); }
beforeEach(() => {
  vi.resetAllMocks(); clearProcedureEditorAccess(); saveProcedureEditorAccess('test-pin');
  api.catalog.mockResolvedValue(catalog);
  api.overview.mockImplementation(async (_processId, published) => ({ processes: processes.map(row => ({ processId: row.id, count: 0, items: items.filter(item => item.processId === row.id && (!published || item.status === 'published')) })) }));
  api.create.mockResolvedValue({ id: 'new-manual', modelCode: 'エアブロー', modelCodeKey: 'エアブロー', processId: 'tools' });
  api.save.mockResolvedValue(undefined); api.delete.mockResolvedValue(undefined); onChanged.mockResolvedValue(undefined);
  api.assignments.mockResolvedValue({ assignments: [{ id: 'micrometer', assemblyProcedureDocumentId: 'micrometer', sortOrder: 0, label: '使い方' }], sequence: { documents: [] } });
  api.replace.mockResolvedValue(undefined); api.deleteDocument.mockResolvedValue(undefined);
});
afterEach(() => { clearProcedureEditorAccess(); });

describe('common mode in the shared screens', () => {
  it('restores common URL and filters list by category, kana and normalized name with toggle-to-clear', async () => {
    showWorkshop('?common=1&process=tools');
    expect(await screen.findByRole('row', { name: 'トルクレンチ_使い方' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: '研削盤_使い方' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '共通', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: '工程で絞り込み' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/テンキー/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '部品を付け直す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /既存の要領書を割り当てる/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'た', exact: true }));
    expect(screen.queryByRole('row', { name: 'マイクロメータ_使い方' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '共通 › 工具 › た行' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'た', exact: true }));
    fireEvent.change(screen.getByLabelText('共通検索'), { target: { value: ' マイクロ ' } });
    expect(screen.getByRole('row', { name: 'マイクロメータ_使い方' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: 'トルクレンチ_使い方' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('共通検索'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '工具', exact: true }));
    expect(screen.getByRole('row', { name: '研削盤_使い方' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?common=1');
    expect(screen.queryByRole('button', { name: '作る' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清掃', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '作る' }));
    expect(within(screen.getByRole('dialog', { name: '共通の手順を作る' })).getByRole('button', { name: '清掃', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reserves an empty action row above the kind toggle until a common child category is selected', async () => {
    showWorkshop();
    await screen.findByRole('button', { name: '工具', exact: true });
    const pane = screen.getByRole('region', { name: '共通一覧' });
    const slot = pane.firstElementChild;
    expect(slot).toHaveClass('h-14', 'shrink-0');
    expect(slot).toBeEmptyDOMElement();
    expect(slot?.nextElementSibling).toBe(screen.getByRole('group', { name: '機種か部品か' }));
    expect(screen.queryByRole('button', { name: '作る' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工具', exact: true }));
    expect(slot).toContainElement(screen.getByRole('button', { name: '作る' }));
    expect(within(pane).getAllByRole('button', { name: '作る' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '既存の要領書を割り当てる' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工具', exact: true }));
    expect(slot).toBeEmptyDOMElement();
  });

  it('preserves common row delete behavior', async () => {
    showWorkshop();
    const row = await screen.findByRole('row', { name: 'マイクロメータ_使い方' });
    fireEvent.click(within(row).getByRole('button', { name: '削除' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '下書きを削除' })).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('micrometer'));
    expect(api.replace).toHaveBeenCalledWith('マイクロメータ', 'tools', { modelCode: 'マイクロメータ', assignments: [] });
  });

  it('browser restores the common route, lists published only and opens the existing viewer', async () => {
    api.assignments.mockResolvedValue({ assignments: [], sequence: { documents: [{ id: 'torque' }] } });
    render(<MemoryRouter initialEntries={['/kiosk/assembly/manuals?common=1&process=tools']}><ProcedureManualBrowser /><Location /></MemoryRouter>);
    const row = await screen.findByRole('row', { name: 'トルクレンチ_使い方' });
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('h-16');
    expect(header.parentElement).toHaveClass('grid-rows-[64px_minmax(0,1fr)]');
    expect(within(header).getAllByRole('link').map(link => link.textContent)).toEqual(['作る・直す', '組立へ戻る']);
    expect(within(header).getByRole('link', { name: '作る・直す' })).toHaveAttribute('href', '/kiosk/assembly/manuals/workshop?common=1&process=tools');
    expect(screen.getByRole('region', { name: '共通一覧' }).firstElementChild).toBe(screen.getByRole('group', { name: '機種か部品か' }));
    expect(api.overview).toHaveBeenCalledWith(undefined, true);
    expect(screen.queryByRole('row', { name: 'マイクロメータ_使い方' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '直す' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '見る' }));
    await waitFor(() => expect(api.assignments).toHaveBeenCalledWith('トルクレンチ', 'tools'));
    expect(await screen.findByText('共通ビューア')).toBeVisible();
    expect(screen.getByTestId('procedure-manuals-left')).not.toBeVisible();
    expect(header).toBeVisible();
    expect(screen.getAllByRole('link', { name: '作る・直す' })).toHaveLength(1);
    expect(screen.getByTestId('location')).toHaveTextContent('common=1');
  });
});

it('shows the assignment error visibly when COMMON 見る fails', async () => {
  api.assignments.mockRejectedValue(new Error('要領書を取得できません'));
  render(<MemoryRouter initialEntries={['/kiosk/assembly/manuals?common=1&process=tools']}><ProcedureManualBrowser /></MemoryRouter>);
  const row = await screen.findByRole('row', { name: 'トルクレンチ_使い方' });
  fireEvent.click(within(row).getByRole('button', { name: '見る' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('要領書を取得できません');
  expect(screen.queryByText('共通ビューア')).not.toBeInTheDocument();
});

describe('common create dialog', () => {
  it('overrides the light full-width panel and gives dark inputs readable text', () => {
    showDialog();
    const dialog = screen.getByRole('dialog', { name: '共通の手順を作る' });
    expect(dialog.firstElementChild).toHaveClass('!bg-[#161c22]', '!text-[#eef3f6]', '!max-w-[1180px]', '!my-auto', '!border', '!border-[#344252]', '!rounded-xl', '!px-7', '!py-6');
    expect(within(dialog).getByRole('heading', { name: '共通の手順を作る' })).toHaveClass('text-[#eef3f6]');
    expect(within(dialog).getByLabelText('対象')).toHaveClass('bg-[#0b0f13]', 'text-[#eef3f6]');
    expect(within(dialog).getByRole('button', { name: '工具', exact: true })).toHaveClass('bg-[#3ba77626]', 'text-[#eef3f6]');
    fireEvent.click(within(dialog).getByRole('button', { name: '分類を編集' }));
    expect(within(dialog).getByLabelText('分類の名前')).toHaveClass('bg-[#0b0f13]', 'text-[#eef3f6]');
  });

  it('preselects category, suggests its known targets and blocks an exact duplicate; similar item opens editor', () => {
    showDialog();
    expect(screen.getByRole('button', { name: '工具', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'トルクレンチ', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '使い方', exact: true }));
    expect(screen.getByLabelText('名前のプレビュー')).toHaveTextContent('トルクレンチ_使い方');
    expect(screen.getByText('同じ手順があります')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '作ってエディタへ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'これを直す' }));
    expect(onFix).toHaveBeenCalledWith(items[0]);
  });

  it('requires reading only for new non-kana targets and creates then navigates with common return state', async () => {
    showDialog();
    fireEvent.change(screen.getByLabelText('対象'), { target: { value: '研削機' } });
    fireEvent.click(screen.getByRole('button', { name: '校正', exact: true }));
    expect(screen.getByRole('button', { name: '作ってエディタへ' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('region', { name: 'よみ' })).getByRole('button', { name: 'か', exact: true }));
    expect(screen.getByRole('button', { name: '作ってエディタへ' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('対象'), { target: { value: 'エアブロー' } });
    expect(screen.queryByRole('region', { name: 'よみ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '作ってエディタへ' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ categoryId: 'tools', target: 'エアブロー', actionId: 'calibrate', kanaRow: 'あ' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('new-manual'));
    expect(screen.getByTestId('location')).toHaveTextContent('common=1');
  });

  it('treats another category as a different procedure and reports server duplicate inline', async () => {
    showDialog('clean');
    fireEvent.change(screen.getByLabelText('対象'), { target: { value: 'トルクレンチ' } });
    fireEvent.click(screen.getByRole('button', { name: '使い方', exact: true }));
    expect(screen.queryByText('同じ手順があります')).not.toBeInTheDocument();
    api.create.mockRejectedValue({ response: { data: { message: '同じ手順があります' } } });
    fireEvent.click(screen.getByRole('button', { name: '作ってエディタへ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同じ手順があります');
  });

  it.each([['分類', 'categories', '清掃', 'clean', '工具'], ['作業', 'actions', '校正', 'calibrate', '使い方']] as const)('supports %s edit-mode add, rename, delete, in-use delete guard and inline errors', async (title, kind, unusedName, unusedId, usedName) => {
    showDialog();
    fireEvent.click(screen.getByRole('button', { name: `${title}を編集` }));
    const section = within(screen.getByRole('region', { name: title, exact: true }));
    fireEvent.change(section.getByLabelText(`${title}の名前`), { target: { value: '新しい名前' } });
    fireEvent.click(section.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(kind, '新しい名前', undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    fireEvent.click(section.getByRole('button', { name: unusedName, exact: true }));
    fireEvent.change(section.getByLabelText(`${title}の名前`), { target: { value: '変更名' } });
    fireEvent.click(section.getByRole('button', { name: '変更' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(kind, '変更名', unusedId));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    fireEvent.click(section.getByRole('button', { name: usedName, exact: true }));
    expect(section.getByRole('button', { name: '削除' })).toBeDisabled();
    fireEvent.click(section.getByRole('button', { name: unusedName, exact: true }));
    fireEvent.click(section.getByRole('button', { name: '削除' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: `${title}を削除` })).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(kind, unusedId));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
    api.save.mockRejectedValue({ response: { data: { message: '同じ名前があります' } } });
    fireEvent.change(section.getByLabelText(`${title}の名前`), { target: { value: '同名' } });
    fireEvent.click(section.getByRole('button', { name: '追加' }));
    expect(await section.findByRole('alert')).toHaveTextContent('同じ名前があります');
    fireEvent.click(section.getByRole('button', { name: '完了' }));
    expect(screen.queryByLabelText(`${title}の名前`)).not.toBeInTheDocument();
  });
});
