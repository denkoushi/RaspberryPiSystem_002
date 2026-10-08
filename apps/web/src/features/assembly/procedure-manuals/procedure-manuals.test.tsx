import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureManualAssignmentDialog } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualBrowser } from './ProcedureManualBrowser';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualOverviewItemDto, ProcedureManualProcessDto } from '../types';

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), allOverview: vi.fn(), models: vi.fn(), processes: vi.fn(), detail: vi.fn(), documents: vi.fn(), pdfs: vi.fn(), save: vi.fn(), history: vi.fn(), blank: vi.fn(), machineCandidates: vi.fn()
}));
vi.mock('../../../api/client', () => ({
  createBlankAssemblyProcedureDocument: mocks.blank,
  listAssemblyMachineNameCandidates: mocks.machineCandidates,
  listProcedureMaterials: async () => [],
  listProcedureManualModels: mocks.models, listProcedureManualProcesses: mocks.processes,
  getProcedureManualModelOverview: mocks.overview, getProcedureManualOverview: mocks.allOverview,
  getProcedureManualAssignments: mocks.detail, listAssemblyProcedureDocumentSummaries: mocks.documents,
  getAssemblyProcedureDocumentRevisions: mocks.history, getKioskDocuments: mocks.pdfs, replaceProcedureManualAssignments: mocks.save
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ sequence, initialDocumentId, showCurrentMarkerButton, onCurrentPageChange, onCurrentStepChange, layout, listOpen, onToggleList, twoPages, onToggleTwoPages }: { initialDocumentId?: string; listOpen?: boolean; onToggleList?: () => void; twoPages?: boolean; onToggleTwoPages?: () => void; layout?: string; onCurrentStepChange?: (step: null, index: number, total: number) => void; sequence: ProcedureManualDetailDto['sequence']; showCurrentMarkerButton?: boolean; onCurrentPageChange?: (page: AssemblyProcedureSequencePageDto | null) => void }) => {
    useEffect(() => { onCurrentPageChange?.({ documentId: sequence.documents[0]?.assemblyProcedureDocumentId } as AssemblyProcedureSequencePageDto); onCurrentStepChange?.(null, 0, 2); }, [sequence, onCurrentPageChange, onCurrentStepChange]);
    return <div data-testid="sequence-viewer" data-layout={layout} data-initial-document-id={initialDocumentId}><ProcedureManualPageRail listOpen={listOpen} onToggleList={onToggleList} twoPages={twoPages} onToggleTwoPages={onToggleTwoPages} total={2} />{sequence.documents.map((d) => <span key={d.orderItemId}>{d.title}</span>)}{showCurrentMarkerButton !== false ? <button>現在の丸数字へ</button> : null}</div>;
  }
}));

function EditorLocation() {
  const location = useLocation();
  return <><p>新規エディタ</p><output data-testid="editor-state">{JSON.stringify(location.state)}</output></>;
}

const processes: ProcedureManualProcessDto[] = [
  { id: 'parent', parentId: null, name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'assembly', parentId: 'parent', name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'inspection', parentId: 'parent', name: '検査工程', sortOrder: 1, active: true, resourceCd: null }
];
const publishedOverviewItem: ProcedureManualOverviewItemDto = { assignmentId: 'pub', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId: 'v2', title: '公開組立手順', status: 'published', publishedRevisionNumber: 2, approval: null, draftRevision: null, unavailableReason: null, pageCount: 3, thumbnailPageUrl: null, otherAssignments: [] };
function countOverview(assembly: number, inspection: number) {
  return { processes: [{ processId: 'assembly', count: assembly, items: Array.from({ length: assembly }, (_, index) => ({ ...publishedOverviewItem, assignmentId: `assembly-${index}`, modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly' })) }, { processId: 'inspection', count: inspection, items: Array.from({ length: inspection }, (_, index) => ({ ...publishedOverviewItem, assignmentId: `inspection-${index}`, modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'inspection' })) }] };
}
const emptyDetail: ProcedureManualDetailDto = {
  assignments: [], sequence: {
    mode: 'configured', source: 'primary_fallback', reason: null, machineName: 'DFD1', machineNameKey: 'DFD1',
    stepSource: 'document_expansion', steps: [], documents: [], fallbackProcedureDocument: null
  }
};

describe('procedure-manuals', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem('procedure-manuals-list-open', 'true');
    mocks.models.mockResolvedValue([{ modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1' }, { modelCode: 'DFD2', modelCodeKey: 'DFD2' }]);
    mocks.processes.mockResolvedValue(processes);
    mocks.allOverview.mockResolvedValue({ processes: [{ processId: 'assembly', count: 0, items: [] }, { processId: 'inspection', count: 0, items: [] }] });
    mocks.overview.mockResolvedValue({ modelCode: 'DFD1', modelCodeKey: 'DFD1', processes: [{ processId: 'assembly', count: 0, items: [] }, { processId: 'inspection', count: 0, items: [] }] });
    mocks.detail.mockResolvedValue(emptyDetail);
    mocks.documents.mockResolvedValue([
      { id: 'v2', revisionRootId: 'root', name: '公開組立手順', status: 'published', isActive: true },
      { id: 'draft', name: '下書き手順', status: 'draft', isActive: true },
      { id: 'draft-head', revisionRootId: 'root-old', name: '改版中', status: 'draft', isActive: true }
    ]);
    mocks.history.mockResolvedValue([{ id: 'old-published', revisionRootId: 'root-old', name: '改版中の旧公開手順', status: 'published', isActive: true, revisionNumber: 2 }]);
    mocks.pdfs.mockResolvedValue([{ id: 'pdf', title: '検査PDF', enabled: true }]);
    mocks.save.mockResolvedValue(undefined);
    mocks.machineCandidates.mockResolvedValue({ candidates: ['ｄｆｄ９'], hasMore: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to a closed list, remembers the toggle and tolerates unavailable storage', async () => {
    localStorage.clear();
    const view = render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(screen.getByTestId('procedure-manuals-left')).not.toBeVisible();
    expect(screen.getByTestId('procedure-manuals-split').className).toContain('grid-cols-[minmax(0,1fr)]');
    fireEvent.click(screen.getByRole('button', { name: '一覧を開閉' }));
    expect(screen.getByTestId('procedure-manuals-left')).toBeVisible();
    expect(screen.getByTestId('procedure-manuals-split').className).toContain('grid-cols-[460px_minmax(0,1fr)]');
    expect(localStorage.getItem('procedure-manuals-list-open')).toBe('true');
    view.unmount();
    const reopened = render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(screen.getByTestId('procedure-manuals-left')).toBeVisible();
    reopened.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(screen.getByTestId('procedure-manuals-left')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '一覧を開閉' }));
    expect(screen.getByTestId('procedure-manuals-left')).toBeVisible();
    await waitFor(() => expect(mocks.models).toHaveBeenCalled());
  });

  it('enables two pages only with the list closed and resets them when opening the list', async () => {
    mocks.detail.mockResolvedValue({ ...emptyDetail, sequence: { ...emptyDetail.sequence, documents: [{ orderItemId: 'one', title: '手順' }] } });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    fireEvent.click(screen.getByRole('button', { name: '組立' }));
    await screen.findByTestId('sequence-viewer');
    expect(screen.getByRole('button', { name: '2 ページ表示' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '一覧を開閉' }));
    const two = screen.getByRole('button', { name: '2 ページ表示' });
    expect(two).toBeEnabled();
    fireEvent.click(two);
    expect(two).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '一覧を開閉' }));
    expect(two).toHaveAttribute('aria-pressed', 'false');
    expect(two).toBeDisabled();
  });

  it('filters loaded models immediately from shared keyboard and tenkey state and marks matches', async () => {
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.click(within(screen.getByRole('group', { name: '機種テンキー' })).getByRole('button', { name: '1' }));
    expect(screen.getByLabelText('機種検索')).toHaveValue('1');
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '機種一覧' }).querySelector('mark')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(screen.getByRole('button', { name: 'DFD2' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: '2' } });
    expect(screen.queryByRole('button', { name: 'DFD1' })).not.toBeInTheDocument();
    expect(mocks.models).toHaveBeenCalledOnce();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('shows overview counts on process and model buttons', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(3, 0));
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    const model = await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.click(model);
    const assembly = screen.getByRole('button', { name: '組立' });
    await waitFor(() => expect(assembly).toHaveTextContent('組立3'));
    expect(mocks.allOverview).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(assembly.querySelector('[aria-hidden="true"]')).toHaveTextContent('3');
    expect(assembly.querySelector('[aria-hidden="true"]')).toHaveClass('font-mono');
    const inspection = screen.getByRole('button', { name: '検査' });
    expect(inspection).toHaveTextContent('検査—');
    expect(inspection).toHaveClass('text-[#9fadb9]');
    expect(inspection).toBeEnabled();
    expect(model).toHaveTextContent('DFD1');
    expect(model.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '機種一覧' })).toHaveTextContent('DFD2');
    expect(screen.getByLabelText('機種検索')).toHaveClass('h-12', 'shrink-0', 'text-[21px]');
    expect(screen.getByRole('group', { name: '機種テンキー' }).parentElement?.parentElement).toHaveClass('grid-cols-[64px_minmax(0,1fr)]');
  });

  it('automatically selects the only process with assignments after a model click', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(0, 2));
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('DFD1', 'inspection'));
    expect(screen.getByRole('button', { name: '検査' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves the process unselected when multiple processes have assignments', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(1, 2));
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '検査' })).toHaveTextContent('2'));
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '組立' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '検査' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not automatically select a process for an initial model URL parameter', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(1, 0));
    render(<MemoryRouter initialEntries={['/kiosk/assembly/manuals?model=DFD1']}><ProcedureManualBrowser /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: '組立' })).toHaveTextContent('1'));
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '組立' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a manually selected process when selecting a model with another sole process', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(1, 0));
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.click(screen.getByRole('button', { name: '検査' }));
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'DFD1' } });
    fireEvent.click(screen.getByRole('button', { name: 'DFD1' }));
    expect(screen.getByRole('button', { name: '検査' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('DFD1', 'inspection'));
  });

  it('uses the selected model counts without requesting a draft-capable model overview', async () => {
    mocks.allOverview.mockResolvedValue(countOverview(1, 2));
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    fireEvent.click(screen.getByRole('button', { name: 'DFD2' }));
    expect(screen.getByRole('button', { name: '組立' })).toHaveTextContent('組立—');
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '検査' }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith('DFD2', 'inspection'));
  });

  it('filters by process alone and restores the full candidates when searching or clearing the process', async () => {
    mocks.allOverview.mockResolvedValue({ processes: [{ processId: 'assembly', count: 1, items: [{ ...publishedOverviewItem, modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly' }] }, { processId: 'inspection', count: 0, items: [] }] });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    await screen.findByRole('button', { name: 'DFD2' });
    fireEvent.click(screen.getByRole('button', { name: '組立' }));
    expect(screen.getByRole('button', { name: '組立' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DFD1' })).toHaveTextContent('1');
    expect(mocks.detail).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'DFD' } });
    expect(screen.getByRole('button', { name: 'DFD2' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '組立' }));
    expect(screen.getByRole('button', { name: 'DFD2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '組立' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('requests published assignments and passes document B as the start when its row is clicked', async () => {
    const publicRow = { ...publishedOverviewItem, modelCode: 'DFD2', modelCodeKey: 'DFD2', processId: 'assembly' };
    mocks.allOverview.mockResolvedValue({ processes: [{ processId: 'assembly', count: 2, items: [{ ...publicRow, assignmentId: 'a', documentId: 'a', title: '公開文書A' }, publicRow] }] });
    mocks.detail.mockResolvedValue({ ...emptyDetail, sequence: { ...emptyDetail.sequence, documents: [{ orderItemId: 'a', assemblyProcedureDocumentId: 'a', title: '公開文書A' }, { orderItemId: 'pub', assemblyProcedureDocumentId: 'v2', title: '公開組立手順' }] } });
    render(<MemoryRouter initialEntries={['/kiosk/assembly/manuals?process=assembly']}><ProcedureManualBrowser /></MemoryRouter>);
    const list = await screen.findByRole('region', { name: '要領書一覧' });
    const row = await within(list).findByRole('button', { name: '公開組立手順' });
    expect(row).toHaveTextContent('DFD2');
    expect(row).toHaveTextContent('組立');
    expect(row).toHaveTextContent('3');
    expect(mocks.allOverview).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '作る・直す' })).toHaveAttribute('href', '/kiosk/assembly/manuals/workshop?process=assembly');
    fireEvent.click(row);
    expect(await screen.findByTestId('sequence-viewer')).toHaveAttribute('data-initial-document-id', 'v2');
    expect(screen.getByTestId('sequence-viewer')).toHaveTextContent('公開組立手順');
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith('DFD2', 'assembly');
    expect(screen.getByRole('link', { name: '作る・直す' })).toHaveAttribute('href', '/kiosk/assembly/manuals/workshop?model=DFD2&process=assembly');
    fireEvent.click(screen.getByRole('button', { name: '組立' }));
    fireEvent.click(screen.getByRole('button', { name: '組立' }));
    expect(await screen.findByTestId('sequence-viewer')).not.toHaveAttribute('data-initial-document-id');
    fireEvent.click(screen.getByRole('button', { name: 'DFD2' }));
    fireEvent.click(await screen.findByRole('button', { name: '公開組立手順' }));
    expect(await screen.findByTestId('sequence-viewer')).toHaveAttribute('data-initial-document-id', 'v2');
    fireEvent.click(screen.getByRole('button', { name: 'DFD2' }));
    fireEvent.click(screen.getByRole('button', { name: 'DFD2' }));
    expect(await screen.findByTestId('sequence-viewer')).not.toHaveAttribute('data-initial-document-id');
  });

  it('searches blank candidates from the master with digits and uses explicit chip colors for both states and common supplements', async () => {
    mocks.machineCandidates.mockResolvedValue({ candidates: ['６３６２'], hasMore: false });
    render(<MemoryRouter><ProcedureManualBlankDialog models={[{ modelCode: '6362', modelCodeKey: '6362' }, { modelCode: '7000', modelCodeKey: '7000' }]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    expect(mocks.machineCandidates).toHaveBeenLastCalledWith({ digitQuery: '', q: '', limit: 30 });
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(mocks.machineCandidates).toHaveBeenLastCalledWith({ digitQuery: '6', q: '', limit: 30 });
    expect(screen.getByLabelText('型番で検索')).toHaveValue('');
    expect(screen.getByLabelText('数字検索')).toHaveTextContent('6');
    const candidate = await screen.findByRole('button', { name: '6362' });
    expect(screen.queryByRole('button', { name: '7000' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '6' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: '機種の選択' }).querySelector('mark')).toHaveTextContent('6');
    fireEvent.click(candidate);
    expect(screen.getByLabelText('名前のプレビュー')).toHaveTextContent('6362_組立_組立');
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeEnabled();
    const chosen = screen.getAllByRole('button', { name: '組立' });
    chosen.forEach(button => expect(button).toHaveClass('border-[#3ba776]', 'bg-[#3ba776]', 'text-[#0b1a12]'));
    const inspection = screen.getByRole('button', { name: '検査' });
    expect(inspection).toHaveClass('border-[#6b7c8d]', 'bg-[#27313b]', 'text-[#eef3f6]');
    expect(inspection.className).not.toContain('aria-pressed:');
    fireEvent.click(inspection);
    expect(inspection).toHaveClass('bg-[#3ba776]');
    expect(chosen[1]).toHaveClass('bg-[#27313b]');
    const common = screen.getByRole('button', { name: '圧入' });
    expect(common).toHaveClass('border-dashed', 'bg-[#27313b]');
    fireEvent.click(common);
    expect(common).toHaveAttribute('aria-pressed', 'true');
    expect(common).toHaveClass('border-dashed', 'bg-[#3ba776]', 'text-[#0b1a12]');
  });

  it('sends text and digits separately and displays only normalized API candidates', async () => {
    mocks.machineCandidates.mockResolvedValue({ candidates: ['ｄｆｄ６３', ' DFD63 ', 'DFD63', 'DFD6-3'], hasMore: false });
    render(<MemoryRouter><ProcedureManualBlankDialog models={[{ modelCode: 'LOCAL63', modelCodeKey: 'LOCAL63' }]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('型番で検索'), { target: { value: 'ｄｆｄ' } });
    expect(mocks.machineCandidates).toHaveBeenLastCalledWith({ digitQuery: '', q: 'ｄｆｄ', limit: 30 });
    expect((await screen.findByRole('button', { name: 'DFD63' })).querySelector('mark')).toHaveTextContent('DFD');
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(mocks.machineCandidates).toHaveBeenLastCalledWith({ digitQuery: '63', q: 'ｄｆｄ', limit: 30 });
    const candidate = await screen.findByRole('button', { name: 'DFD63' });
    expect(candidate.querySelector('mark')).toHaveTextContent('63');
    expect(screen.getByRole('button', { name: 'DFD6-3' }).querySelector('mark')).toBeNull();
    expect(screen.queryByRole('button', { name: 'DFD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LOCAL63' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'DFD63' })).toHaveLength(1);
    expect(screen.getByLabelText('型番で検索')).toHaveAttribute('maxlength', '120');
    fireEvent.click(candidate);
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(mocks.machineCandidates).toHaveBeenLastCalledWith({ digitQuery: '6', q: 'ｄｆｄ', limit: 30 });
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeDisabled();
    await screen.findByRole('button', { name: 'DFD63' });
  });

  it.each(['success', 'failure'])('discards an older search %s after the latest response', async (outcome) => {
    let resolveOld!: (value: { candidates: string[]; hasMore: boolean }) => void;
    let rejectOld!: (error: Error) => void;
    const oldRequest = new Promise<{ candidates: string[]; hasMore: boolean }>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    mocks.machineCandidates.mockReturnValueOnce(oldRequest);
    render(<MemoryRouter><ProcedureManualBlankDialog models={[]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('検索中…');
    fireEvent.change(screen.getByLabelText('型番で検索'), { target: { value: 'DFD9' } });
    await screen.findByRole('button', { name: 'DFD9' });
    await act(async () => {
      if (outcome === 'success') resolveOld({ candidates: ['OLD'], hasMore: true });
      else rejectOld(new Error('old search failed'));
    });
    expect(screen.getByRole('button', { name: 'DFD9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OLD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument();
    expect(screen.queryByText('他にも候補があります。数字を追加してください')).not.toBeInTheDocument();
  });

  it('keeps the latest search loading when an older response arrives first', async () => {
    let resolveOld!: (value: { candidates: string[]; hasMore: boolean }) => void;
    let resolveLatest!: (value: { candidates: string[]; hasMore: boolean }) => void;
    mocks.machineCandidates
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveLatest = resolve; }));
    render(<MemoryRouter><ProcedureManualBlankDialog models={[]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    await act(async () => { resolveOld({ candidates: ['OLD'], hasMore: true }); });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('検索中…');
    expect(screen.queryByRole('button', { name: 'OLD' })).not.toBeInTheDocument();
    await act(async () => { resolveLatest({ candidates: ['DFD9'], hasMore: false }); });
    expect(screen.getByRole('button', { name: 'DFD9' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: '' })).not.toBeInTheDocument();
  });

  it('shows more-candidate, empty and failed-search messages', async () => {
    mocks.machineCandidates
      .mockResolvedValueOnce({ candidates: ['DFD9'], hasMore: true })
      .mockResolvedValueOnce({ candidates: [], hasMore: false })
      .mockRejectedValueOnce(new Error('search failed'));
    render(<MemoryRouter><ProcedureManualBlankDialog models={[]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByText('他にも候補があります。数字を追加してください')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('型番で検索'), { target: { value: 'missing' } });
    expect(await screen.findByText('該当する機種がありません')).toBeInTheDocument();
    expect(screen.queryByText('他にも候補があります。数字を追加してください')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DFD9' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('型番で検索'), { target: { value: 'retry' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('機種を検索できませんでした');
    expect(screen.queryByText('該当する機種がありません')).not.toBeInTheDocument();
  });

  it('preserves the initial model and uses explicit readable colors in the name strip and actions', async () => {
    mocks.machineCandidates.mockResolvedValue({ candidates: [], hasMore: false });
    render(<MemoryRouter><ProcedureManualBlankDialog models={[]} processes={processes} modelCode="ｄｆｄ１" processId="inspection" onClose={vi.fn()} /></MemoryRouter>);
    const preview = screen.getByLabelText('名前のプレビュー');
    expect(preview).toHaveTextContent('DFD1_組立_検査');
    expect(preview).toHaveClass('text-[#eef3f6]');
    const strip = preview.closest('.bg-\\[\\#1b222a\\]');
    expect(strip).toBeInTheDocument();
    expect(within(strip as HTMLElement).getByText(/保存名:/)).toHaveClass('text-[#9fadb9]');
    expect(screen.getByRole('button', { name: '名前を直接入力' })).toHaveClass('text-[#eef3f6]', 'border-[#6b7c8d]');
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass('text-[#eef3f6]', 'border-[#6b7c8d]');
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toHaveClass('text-[#0b1a12]', 'bg-[#3ba776]');
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeEnabled();
    await screen.findByText('該当する機種がありません');
    expect(preview).toHaveTextContent('DFD1_組立_検査');
    fireEvent.click(screen.getByRole('button', { name: '名前を直接入力' }));
    expect(screen.getByLabelText('要領書名')).toHaveValue('DFD1_組立_検査');
    expect(screen.getByRole('button', { name: '名前の組み立てに戻る' })).toHaveClass('text-[#eef3f6]', 'border-[#6b7c8d]');
  });

  it('keeps only viewing navigation in the left header and a headerless manuals viewer', async () => {
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    const split = screen.getByTestId('procedure-manuals-split');
    expect(split).toHaveClass('grid-cols-[460px_minmax(0,1fr)]');
    const left = screen.getByTestId('procedure-manuals-left');
    expect(within(left).getByRole('heading', { name: '要領書' })).toBeInTheDocument();
    expect(within(left).getByRole('link', { name: '作る・直す' })).toHaveAttribute('href', '/kiosk/assembly/manuals/workshop');
    expect(within(left).getByRole('link', { name: '組立へ戻る' })).toHaveAttribute('href', '/kiosk/assembly');
    for (const name of ['白紙から作る', '素材 0', '動画', '割り当て']) expect(within(left).queryByRole('button', { name })).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'DFD1' });
    expect(screen.getByRole('region', { name: '要領書' })).not.toContainElement(screen.getByRole('heading', { name: '要領書' }));
  });

  it('creates a named blank document and navigates to its editor', async () => {
    mocks.blank.mockResolvedValue({ id: 'new-document' });
    render(<MemoryRouter><Routes><Route path="/" element={<ProcedureManualBlankDialog models={[]} processes={processes} modelCode="" processId="" onClose={vi.fn()} />} /><Route path="/kiosk/assembly/procedure-documents/:id/edit" element={<EditorLocation />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '名前を直接入力' }));
    fireEvent.change(screen.getByLabelText('要領書名'), { target: { value: '  新規要領書  ' } });
    fireEvent.click(screen.getByRole('button', { name: '作成してエディタへ' }));
    expect(await screen.findByText('新規エディタ')).toBeInTheDocument();
    expect(mocks.blank).toHaveBeenCalledExactlyOnceWith('新規要領書', undefined);
  });

  it('builds the name from normalized model, master process and supplement, then assigns and opens the editor', async () => {
    const allProcesses = [...processes,
      { id: 'machining', parentId: null, name: '加工', sortOrder: 2 },
      { id: 'cutting', parentId: 'machining', name: '切削', sortOrder: 0 },
      { id: 'grinding', parentId: 'machining', name: '研削', sortOrder: 1 }
    ];
    mocks.blank.mockResolvedValue({ id: 'new-document' });
    render(<MemoryRouter><Routes><Route path="/" element={<ProcedureManualBlankDialog models={[]} processes={allProcesses} modelCode="" processId="" onClose={vi.fn()} />} /><Route path="/kiosk/assembly/procedure-documents/:id/edit" element={<EditorLocation />} /></Routes></MemoryRouter>);
    const dialog = screen.getByRole('dialog', { name: '白紙から作る' });
    fireEvent.change(within(dialog).getByLabelText('型番で検索'), { target: { value: 'ｄｆｄ９' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /DFD\s*9/ }));
    expect(within(dialog).getByLabelText('名前のプレビュー')).toHaveTextContent('DFD9_組立_組立');
    fireEvent.click(within(dialog).getByRole('button', { name: '加工' }));
    expect(within(dialog).queryByRole('button', { name: '検査' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '研削' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '圧入' }));
    expect(within(dialog).getByLabelText('名前のプレビュー')).toHaveTextContent('DFD9_加工_研削_圧入');
    fireEvent.click(within(dialog).getByRole('button', { name: '名前を直接入力' }));
    expect(within(dialog).getByLabelText('要領書名')).toHaveValue('DFD9_加工_研削_圧入');
    fireEvent.click(within(dialog).getByRole('button', { name: '名前の組み立てに戻る' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '作成してエディタへ' }));
    expect(await screen.findByText('新規エディタ')).toBeInTheDocument();
    expect(mocks.blank).toHaveBeenCalledExactlyOnceWith('DFD9_加工_研削_圧入', { modelCode: 'DFD9', processId: 'grinding' });
    expect(JSON.parse(screen.getByTestId('editor-state').textContent!)).toMatchObject({ returnTo: '/kiosk/assembly/manuals/workshop?model=DFD9&process=grinding', context: { modelCode: 'DFD9', modelCodeKey: 'DFD9', processId: 'grinding', processName: '加工 › 研削', mode: 'make' } });
  });

  it('shows model search, then processes, then the assigned sequence and missing-publication notice', async () => {
    mocks.detail.mockResolvedValue({
      ...emptyDetail,
      assignments: [{ id: 'missing', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', sortOrder: 1, label: '検査資料', unavailableReason: 'no_published_revision', resolvedDocumentId: null }],
      sequence: { ...emptyDetail.sequence, documents: [{ orderItemId: 'one', assemblyProcedureDocumentId: 'doc', title: '表示手順', lastApproval: { employeeName: '承認太郎', positionName: '班長', approvedAt: '2026-10-05T09:00:00Z' } }] }
    });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'DFD1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '組立' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'ｄｆｄ１' } });
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /DFD\s*1/ }));
    fireEvent.click(await screen.findByRole('button', { name: '組立' }));
    expect(await screen.findByTestId('sequence-viewer')).toHaveTextContent('表示手順');
    expect(screen.getByTestId('sequence-viewer')).toHaveAttribute('data-layout', 'manuals');
    expect(screen.getByRole('region', { name: '承認・動画' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '工程で絞り込み' })).queryByRole('region', { name: '承認・動画' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '機種一覧' })).queryByText('検査資料: 公開版なし')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('検査資料: 公開版なし')).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledWith('DFD1', 'assembly');
    expect(screen.queryByRole('button', { name: '現在の丸数字へ' })).not.toBeInTheDocument();
    expect(await screen.findByText(/承認: 承認太郎\(班長\)/)).toBeInTheDocument();
  });

  it('shows an empty model list and keeps the workshop link available', async () => {
    mocks.models.mockResolvedValue([]);
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByText('該当する機種がありません')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '作る・直す' })).toBeInTheDocument();
  });

  it('inherits the model and process query and links to the same workshop context', async () => {
    render(<MemoryRouter initialEntries={['/kiosk/assembly/manuals?model=DFD1&process=inspection']}><ProcedureManualBrowser /></MemoryRouter>);
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith('DFD1', 'inspection'));
    expect(screen.getByRole('link', { name: '作る・直す' })).toHaveAttribute('href', '/kiosk/assembly/manuals/workshop?model=DFD1&process=inspection');
  });

  it('offers document choices before a model is entered but waits to add until model and process are ready', async () => {
    render(<ProcedureManualAssignmentDialog modelCode="" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('まだ割り当てがありません。型番を入れて文書を追加してください')).toBeInTheDocument();
    await screen.findByRole('option', { name: '公開組立手順' });
    expect(screen.getByLabelText('文書')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('文書'), { target: { value: 'assembly:root' } });
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('型番'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByLabelText('表示名 1')).toHaveAttribute('placeholder', '表示名(任意)');
  });

  it('selects published images and PDFs, reorders them, and saves normalized model and root references', async () => {
    const saved = vi.fn();
    render(<ProcedureManualAssignmentDialog modelCode="ｄｆｄ１" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={saved} />);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '追加' })).toBeDisabled());
    await screen.findByRole('option', { name: '公開組立手順' });
    expect(screen.queryByRole('option', { name: '下書き手順' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '改版中の旧公開手順' })).toHaveValue('assembly:root-old');
    await waitFor(() => expect(screen.getByLabelText('文書')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('文書'), { target: { value: 'assembly:root' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.change(screen.getByLabelText('文書'), { target: { value: 'pdf:pdf' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.click(screen.getByRole('button', { name: '上へ 2' }));
    fireEvent.change(screen.getByLabelText('表示名 1'), { target: { value: '検査' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('DFD1', 'assembly', {
      modelCode: 'ｄｆｄ１', assignments: [
        { kioskDocumentId: 'pdf', assemblyProcedureDocumentId: null, sortOrder: 0, label: '検査' },
        { kioskDocumentId: null, assemblyProcedureDocumentId: 'root', sortOrder: 1, label: null }
      ]
    }));
    expect(saved).toHaveBeenCalledWith('DFD1', 'assembly');
  });

  it('reorders and renames an automatically assigned unpublished DRAFT alongside a published document', async () => {
    mocks.detail.mockResolvedValue({ ...emptyDetail, assignments: [
      { kioskDocumentId: null, assemblyProcedureDocumentId: 'root', sortOrder: 0, label: '公開組立手順' },
      { kioskDocumentId: null, assemblyProcedureDocumentId: 'draft', sortOrder: 1, label: '自動追加の下書き', unavailableReason: 'no_published_revision' }
    ] });
    const saved = vi.fn();
    render(<ProcedureManualAssignmentDialog modelCode="DFD1" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={saved} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '上へ 2' })).toBeEnabled());
    expect(screen.queryByRole('option', { name: '下書き手順' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上へ 2' }));
    fireEvent.change(screen.getByLabelText('表示名 1'), { target: { value: '下書きの表示名を変更' } });
    fireEvent.change(screen.getByLabelText('表示名 2'), { target: { value: '公開手順の表示名を変更' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('DFD1', 'assembly'));
    expect(mocks.save).toHaveBeenCalledWith('DFD1', 'assembly', { modelCode: 'DFD1', assignments: [
      { kioskDocumentId: null, assemblyProcedureDocumentId: 'draft', sortOrder: 0, label: '下書きの表示名を変更' },
      { kioskDocumentId: null, assemblyProcedureDocumentId: 'root', sortOrder: 1, label: '公開手順の表示名を変更' }
    ] });
  });

  it('keeps the dialog open and displays a permission message after a 403 save', async () => {
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    const saved = vi.fn();
    render(<ProcedureManualAssignmentDialog modelCode="DFD1" processId="assembly" processes={processes} onClose={vi.fn()} onSaved={saved} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
