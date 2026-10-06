import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureManualWorkshop } from './ProcedureManualWorkshop';

import type { ProcedureManualModelOverviewDto, ProcedureManualOverviewItemDto } from '../types';

const mocks = vi.hoisted(() => ({ models: vi.fn(), candidates: vi.fn(), processes: vi.fn(), overview: vi.fn(), detail: vi.fn(), replace: vi.fn(), delete: vi.fn(), materials: vi.fn(), videos: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureManualModels: mocks.models, listAssemblyMachineNameCandidates: mocks.candidates,
  listProcedureManualProcesses: mocks.processes, getProcedureManualModelOverview: mocks.overview,
  getProcedureManualAssignments: mocks.detail, replaceProcedureManualAssignments: mocks.replace,
  deleteAssemblyProcedureDocument: mocks.delete,
  listProcedureMaterials: mocks.materials, listProcedureVideos: mocks.videos
}));
vi.mock('../../../hooks/useProtectedImageBlobUrl', () => ({ useProtectedImageBlobUrl: (url: string) => ({ blobUrl: url }) }));
vi.mock('./ProcedureManualBlankDialog', () => ({ ProcedureManualBlankDialog: ({ modelCode, processId }: { modelCode: string; processId: string }) => <div role="dialog" aria-label="白紙から作る">{modelCode} / {processId}</div> }));
vi.mock('./ProcedureManualAssignmentDialog', async importOriginal => ({
  ...await importOriginal<typeof import('./ProcedureManualAssignmentDialog')>(),
  ProcedureManualAssignmentDialog: ({ modelCode, processId, onSaved }: { modelCode: string; processId: string; onSaved: (model: string, process: string) => void }) => <div role="dialog" aria-label="割り当て">{modelCode} / {processId}<button onClick={() => onSaved('DFD1', 'assembly')}>保存</button></div>
}));
vi.mock('./ProcedureMaterialShelfDialog', () => ({ ProcedureMaterialShelfDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="素材"><button onClick={onClose}>閉じる</button></div> }));
vi.mock('./ProcedureVideoShelfDialog', () => ({ ProcedureVideoShelfDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="動画"><button onClick={onClose}>閉じる</button></div> }));
const processes = [
  { id: 'parent', name: '組立工程', parentId: null },
  { id: 'assembly', name: '組立工程', parentId: 'parent' },
  { id: 'inspection', name: '検査工程', parentId: 'parent' }
];
const published: ProcedureManualOverviewItemDto = { assignmentId: 'pub', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId: 'v2', title: '公開手順', status: 'published', publishedRevisionNumber: 2, draftRevision: null, unavailableReason: null, pageCount: 3, thumbnailPageUrl: '/page.png' };
const items: ProcedureManualOverviewItemDto[] = [
  { ...published, draftRevision: { documentId: 'v3', revisionNumber: 3, editLease: { holderLabel: '佐藤', acquiredAt: '2026-10-06T09:12:00' } } },
  { ...published, assignmentId: 'draft', documentId: 'draft1', title: '初版下書き', status: 'draft', publishedRevisionNumber: null },
  { ...published, assignmentId: 'bad', documentId: 'invalid', title: '無効手順', status: 'unavailable', unavailableReason: 'disabled', pageCount: null, thumbnailPageUrl: null },
  { ...published, assignmentId: 'pdf', documentId: 'pdf', title: 'キオスクPDF', kind: 'kiosk_document', publishedRevisionNumber: null, thumbnailPageUrl: null }
];
const overview: ProcedureManualModelOverviewDto = { modelCode: 'DFD1', modelCodeKey: 'DFD1', processes: [{ processId: 'assembly', count: items.length, items }, { processId: 'inspection', count: 0, items: [] }] };
function Location() { const location = useLocation(); return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</output>; }
function show(query = '?model=DFD1&process=assembly') { return render(<MemoryRouter initialEntries={[`/kiosk/assembly/manuals/workshop${query}`]}><ProcedureManualWorkshop /><Location /></MemoryRouter>); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.models.mockResolvedValue([{ modelCode: 'DFD1', modelCodeKey: 'DFD1' }, { modelCode: 'DFD1', modelCodeKey: 'ｄｆｄ１' }]);
  mocks.processes.mockResolvedValue(processes); mocks.overview.mockResolvedValue(overview);
  mocks.candidates.mockResolvedValue({ candidates: ['ｄｆｄ６３', ' DFD63 ', 'DFD63'], hasMore: false });
  mocks.materials.mockResolvedValue([{}, {}]); mocks.videos.mockResolvedValue([{}]);
  mocks.replace.mockResolvedValue(undefined);
  mocks.delete.mockResolvedValue(undefined);
  mocks.detail.mockResolvedValue({ assignments: [
    { id: 'pub', assemblyProcedureDocumentId: 'root', kioskDocumentId: null, sortOrder: 0, label: null },
    { id: 'draft', assemblyProcedureDocumentId: 'draft1', kioskDocumentId: null, sortOrder: 1, label: '下書き' },
    { id: 'pdf', assemblyProcedureDocumentId: null, kioskDocumentId: 'pdf', sortOrder: 2, label: 'PDF' }
  ] });
});

describe('procedure-manuals workshop', () => {
  it('uses three columns, default models, process counts, badges and valid actions', async () => {
    show();
    expect(screen.getByTestId('procedure-manuals-workshop')).toHaveClass('grid-rows-[64px_minmax(0,1fr)]');
    expect(screen.getByRole('region', { name: '機種一覧' }).parentElement).toHaveClass('grid-cols-[440px_300px_minmax(0,1fr)]');
    expect(await screen.findByRole('button', { name: 'DFD1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('button', { name: 'DFD1' })).toHaveLength(1);
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: '組立 › 組立 4' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '組立 › 検査 —' })).toBeInTheDocument();
    const pub = screen.getByRole('article', { name: '公開手順' });
    expect(within(pub).getByText('公開 第2版')).toHaveClass('text-[#3ba776]');
    expect(within(pub).getByText('改版中 · 佐藤 09:12〜')).toHaveClass('bg-[#f6b93b1f]');
    expect(within(pub).getByText('3 ページ')).toBeInTheDocument();
    expect(within(pub).getByRole('img')).toHaveAttribute('src', '/page.png');
    expect(within(pub).getByRole('link', { name: '使う' })).toHaveAttribute('href', '/kiosk/assembly/templates/new?procedureDocumentId=v2');
    const draft = screen.getByRole('article', { name: '初版下書き' });
    expect(within(draft).getByText('下書き')).toHaveClass('text-[#f6b93b]');
    expect(within(draft).getByRole('button', { name: '直す' })).toBeInTheDocument();
    expect(within(draft).queryByRole('link', { name: '使う' })).not.toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: '削除' })).toBeInTheDocument();
    for (const name of ['公開手順', '無効手順', 'キオスクPDF']) expect(within(screen.getByRole('article', { name })).queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
    for (const name of ['無効手順', 'キオスクPDF']) expect(within(screen.getByRole('article', { name })).queryByRole('button', { name: '直す' })).not.toBeInTheDocument();
    expect(screen.getByText('無効')).toHaveClass('text-red-400');
  });

  it('switches to immediate normalized master searches with separate digits and text', async () => {
    show('');
    await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'ｄｆｄ' } });
    expect(mocks.candidates).toHaveBeenLastCalledWith({ q: 'ｄｆｄ', digitQuery: '', limit: 30 });
    expect(await screen.findByRole('button', { name: 'DFD63' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'DFD63' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'DFD63' }).querySelector('mark')).toHaveTextContent('DFD');
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(mocks.candidates).toHaveBeenLastCalledWith({ q: 'ｄｆｄ', digitQuery: '6', limit: 30 });
    expect((await screen.findByRole('button', { name: 'DFD63' })).querySelector('mark')).toHaveTextContent('6');
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    await screen.findByRole('button', { name: 'DFD1' });
    expect(mocks.models).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'])('discards an old master search %s after clearing the input', async outcome => {
    let resolve!: (value: { candidates: string[]; hasMore: boolean }) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<{ candidates: string[]; hasMore: boolean }>((done, fail) => { resolve = done; reject = fail; });
    mocks.candidates.mockReturnValueOnce(pending);
    show(''); await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'OLD' } });
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: '' } });
    await screen.findByRole('button', { name: 'DFD1' });
    await act(async () => { if (outcome === 'success') resolve({ candidates: ['OLD'], hasMore: true }); else reject(new Error('old')); });
    expect(screen.queryByRole('button', { name: 'OLD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses a short prompt until model and process are selected and supports an empty process', async () => {
    show('');
    expect(within(screen.getByRole('region', { name: '要領書の札' })).getByText('機種を選択')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    expect(screen.getByText('工程を選択')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '組立 › 検査 —' }));
    expect(await screen.findByRole('heading', { name: 'DFD1 › 組立 › 検査' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '作る' })).toBeEnabled();
  });

  it('passes the selected model and process to make and assignment dialogs', async () => {
    const view = show();
    fireEvent.click(await screen.findByRole('button', { name: '作る' }));
    expect(screen.getByRole('dialog', { name: '白紙から作る' })).toHaveTextContent('DFD1 / assembly');
    view.unmount(); show();
    fireEvent.click(await screen.findByRole('button', { name: '＋ 既存の要領書を割り当てる' }));
    expect(screen.getByRole('dialog', { name: '割り当て' })).toHaveTextContent('DFD1 / assembly');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(3));
  });

  it.each([true, false])('opens an existing revision draft or the published editor path (draft=%s)', async draft => {
    if (!draft) mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: 1, items: [published] }] });
    show();
    const pub = await screen.findByRole('article', { name: '公開手順' });
    fireEvent.click(within(pub).getByRole('button', { name: '直す' }));
    expect(JSON.parse(screen.getByTestId('location').textContent!)).toMatchObject({ pathname: `/kiosk/assembly/procedure-documents/${draft ? 'v3' : 'v2'}/edit`, state: {
      returnTo: '/kiosk/assembly/manuals/workshop?model=DFD1&process=assembly', context: { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode: 'fix' }
    } });
  });

  it('confirms removal once, preserves root references and labels, and refreshes counts', async () => {
    show(); const pub = await screen.findByRole('article', { name: '公開手順' });
    fireEvent.click(within(pub).getByRole('button', { name: '外す' }));
    expect(mocks.replace).not.toHaveBeenCalled();
    for (const button of within(screen.getByRole('dialog')).getAllByRole('button')) expect(button).toHaveClass('min-h-11');
    fireEvent.click(within(screen.getByRole('dialog', { name: '割り当てを外す' })).getByRole('button', { name: 'キャンセル' }));
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.click(within(pub).getByRole('button', { name: '外す' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '割り当てを外す' })).getByRole('button', { name: '外す' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('DFD1', 'assembly', { modelCode: 'DFD1', assignments: [
      { assemblyProcedureDocumentId: 'draft1', kioskDocumentId: null, sortOrder: 0, label: '下書き' },
      { assemblyProcedureDocumentId: null, kioskDocumentId: 'pdf', sortOrder: 1, label: 'PDF' }
    ] }));
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2));
  });

  it.each(['外す', '削除'])('refreshes changed assignments without PUT or DELETE when the selected ID is missing (%s)', async action => {
    mocks.detail.mockResolvedValue({ assignments: [{ id: 'new-id', assemblyProcedureDocumentId: 'draft1', sortOrder: 0 }] });
    show(); const draft = await screen.findByRole('article', { name: '初版下書き' });
    fireEvent.click(within(draft).getByRole('button', { name: action }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: action }));
    expect(await screen.findByRole('alert')).toHaveTextContent('割り当てが更新されました。もう一度確認してください');
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2));
    expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each(['success', '409'])('unassigns an initial draft before DELETE and refreshes the overview (%s)', async outcome => {
    const remaining = items.filter(item => item.assignmentId !== 'draft');
    mocks.overview.mockResolvedValueOnce(overview).mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: remaining.length, items: remaining }] });
    if (outcome === '409') mocks.delete.mockRejectedValue({ response: { status: 409, data: { message: 'テンプレートで使用中の手順書は削除できません' } } });
    show(); const draft = await screen.findByRole('article', { name: '初版下書き' });
    fireEvent.click(within(draft).getByRole('button', { name: '削除' }));
    const dialog = screen.getByRole('dialog', { name: '要領書を削除' });
    expect(dialog).toHaveTextContent('割り当てを外して削除します。元に戻せません');
    for (const button of within(dialog).getAllByRole('button')) expect(button).toHaveClass('min-h-11');
    expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledExactlyOnceWith('draft1'));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('DFD1', 'assembly', { modelCode: 'DFD1', assignments: [
      { assemblyProcedureDocumentId: 'root', kioskDocumentId: null, sortOrder: 0, label: null },
      { assemblyProcedureDocumentId: null, kioskDocumentId: 'pdf', sortOrder: 1, label: 'PDF' }
    ] });
    expect(mocks.replace.mock.invocationCallOrder[0]).toBeLessThan(mocks.delete.mock.invocationCallOrder[0]);
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('article', { name: '初版下書き' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    if (outcome === '409') expect(screen.getByRole('alert')).toHaveTextContent('テンプレートで使用中の手順書は削除できません。文書は未割り当てのまま残っています。');
    else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cancels deletion and does not DELETE if unassigning fails', async () => {
    mocks.replace.mockRejectedValue(new Error('外せません'));
    show(); const draft = await screen.findByRole('article', { name: '初版下書き' });
    fireEvent.click(within(draft).getByRole('button', { name: '削除' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }));
    expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
    fireEvent.click(within(draft).getByRole('button', { name: '削除' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('外せません');
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.overview).toHaveBeenCalledTimes(1);
  });

  it('shows removal errors near the cards and opens the unchanged shelves with counts', async () => {
    mocks.replace.mockRejectedValue(new Error('外せません'));
    show(); const pub = await screen.findByRole('article', { name: '公開手順' });
    fireEvent.click(within(pub).getByRole('button', { name: '外す' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '外す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('外せません');
    fireEvent.click(await screen.findByRole('button', { name: '素材 2' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '閉じる' }));
    fireEvent.click(await screen.findByRole('button', { name: '動画 1' }));
    expect(screen.getByRole('dialog', { name: '動画' })).toBeInTheDocument();
  });
});
