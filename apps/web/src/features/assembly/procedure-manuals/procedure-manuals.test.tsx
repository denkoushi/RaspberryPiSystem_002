import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureManualAssignmentDialog } from './ProcedureManualAssignmentDialog';
import { ProcedureManualBlankDialog } from './ProcedureManualBlankDialog';
import { ProcedureManualBrowser } from './ProcedureManualBrowser';
import { ProcedureManualPageRail } from './ProcedureManualPageRail';

import type { AssemblyProcedureSequencePageDto, ProcedureManualDetailDto, ProcedureManualProcessDto } from '../types';

const mocks = vi.hoisted(() => ({
  models: vi.fn(), processes: vi.fn(), detail: vi.fn(), documents: vi.fn(), pdfs: vi.fn(), save: vi.fn(), history: vi.fn(), blank: vi.fn()
}));
vi.mock('../../../api/client', () => ({
  createBlankAssemblyProcedureDocument: mocks.blank,
  listProcedureMaterials: async () => [],
  listProcedureManualModels: mocks.models, listProcedureManualProcesses: mocks.processes,
  getProcedureManualAssignments: mocks.detail, listAssemblyProcedureDocumentSummaries: mocks.documents,
  getAssemblyProcedureDocumentRevisions: mocks.history, getKioskDocuments: mocks.pdfs, replaceProcedureManualAssignments: mocks.save
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ sequence, showCurrentMarkerButton, onCurrentPageChange, onCurrentStepChange, layout, listOpen, onToggleList, twoPages, onToggleTwoPages }: { listOpen?: boolean; onToggleList?: () => void; twoPages?: boolean; onToggleTwoPages?: () => void; layout?: string; onCurrentStepChange?: (step: null, index: number, total: number) => void; sequence: ProcedureManualDetailDto['sequence']; showCurrentMarkerButton?: boolean; onCurrentPageChange?: (page: AssemblyProcedureSequencePageDto | null) => void }) => {
    useEffect(() => { onCurrentPageChange?.({ documentId: sequence.documents[0]?.assemblyProcedureDocumentId } as AssemblyProcedureSequencePageDto); onCurrentStepChange?.(null, 0, 2); }, [sequence, onCurrentPageChange, onCurrentStepChange]);
    return <div data-testid="sequence-viewer" data-layout={layout}><ProcedureManualPageRail listOpen={listOpen} onToggleList={onToggleList} twoPages={twoPages} onToggleTwoPages={onToggleTwoPages} total={2} />{sequence.documents.map((d) => <span key={d.orderItemId}>{d.title}</span>)}{showCurrentMarkerButton !== false ? <button>現在の丸数字へ</button> : null}</div>;
  }
}));

const processes: ProcedureManualProcessDto[] = [
  { id: 'parent', parentId: null, name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'assembly', parentId: 'parent', name: '組立工程', sortOrder: 0, active: true, resourceCd: null },
  { id: 'inspection', parentId: 'parent', name: '検査工程', sortOrder: 1, active: true, resourceCd: null }
];
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
    mocks.detail.mockResolvedValue(emptyDetail);
    mocks.documents.mockResolvedValue([
      { id: 'v2', revisionRootId: 'root', name: '公開組立手順', status: 'published', isActive: true },
      { id: 'draft', name: '下書き手順', status: 'draft', isActive: true },
      { id: 'draft-head', revisionRootId: 'root-old', name: '改版中', status: 'draft', isActive: true }
    ]);
    mocks.history.mockResolvedValue([{ id: 'old-published', revisionRootId: 'root-old', name: '改版中の旧公開手順', status: 'published', isActive: true, revisionNumber: 2 }]);
    mocks.pdfs.mockResolvedValue([{ id: 'pdf', title: '検査PDF', enabled: true }]);
    mocks.save.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to a closed list, remembers the toggle and tolerates unavailable storage', async () => {
    localStorage.clear();
    const view = render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(screen.getByTestId('procedure-manuals-left')).not.toBeVisible();
    expect(screen.getByTestId('procedure-manuals-split').className).toContain('grid-cols-[minmax(0,1fr)]');
    fireEvent.click(screen.getByRole('button', { name: '一覧を開閉' }));
    expect(screen.getByTestId('procedure-manuals-left')).toBeVisible();
    expect(screen.getByTestId('procedure-manuals-split').className).toContain('grid-cols-[760px_minmax(0,1fr)]');
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
    fireEvent.click(screen.getByRole('button', { name: '組立工程 › 組立工程' }));
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

  it('filters blank candidates immediately and uses explicit chip colors for both states and common supplements', () => {
    render(<MemoryRouter><ProcedureManualBlankDialog models={[{ modelCode: '6362', modelCodeKey: '6362' }, { modelCode: '7000', modelCodeKey: '7000' }]} processes={processes} modelCode="" processId="" onClose={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(screen.getByLabelText('型番で検索')).toHaveValue('6');
    expect(screen.queryByRole('button', { name: '7000' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '機種の選択' }).querySelector('mark')).toHaveTextContent('6');
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

  it('uses two panes with all actions in the left header and a headerless manuals viewer', async () => {
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    const split = screen.getByTestId('procedure-manuals-split');
    expect(split).toHaveClass('grid-cols-[760px_minmax(0,1fr)]');
    const left = screen.getByTestId('procedure-manuals-left');
    expect(within(left).getByRole('heading', { name: '要領書' })).toBeInTheDocument();
    expect(within(left).getByRole('button', { name: '白紙から作る' })).toHaveClass('h-11');
    expect(within(left).getByRole('button', { name: '素材 0' })).toBeInTheDocument();
    expect(within(left).getByRole('button', { name: '動画' })).toBeInTheDocument();
    expect(within(left).getByRole('link', { name: '組立へ戻る' })).toHaveAttribute('href', '/kiosk/assembly');
    await waitFor(() => expect(within(left).getByRole('button', { name: '割り当て' })).toBeEnabled());
    expect(screen.getByRole('region', { name: '要領書' })).not.toContainElement(screen.getByRole('heading', { name: '要領書' }));
  });

  it('creates a named blank document and navigates to its editor', async () => {
    mocks.blank.mockResolvedValue({ id: 'new-document' });
    render(<MemoryRouter><Routes><Route path="/" element={<ProcedureManualBrowser />} /><Route path="/kiosk/assembly/procedure-documents/:id/edit" element={<p>新規エディタ</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '白紙から作る' }));
    expect(screen.getByRole('button', { name: '作成してエディタへ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '名前を直接入力' }));
    fireEvent.change(screen.getByLabelText('要領書名'), { target: { value: '  新規要領書  ' } });
    fireEvent.click(screen.getByRole('button', { name: '作成してエディタへ' }));
    expect(await screen.findByText('新規エディタ')).toBeInTheDocument();
    expect(mocks.blank).toHaveBeenCalledExactlyOnceWith('新規要領書', undefined);
  });

  it('builds the name from normalized model, master process and supplement, then assigns and opens the editor', async () => {
    mocks.processes.mockResolvedValue([...processes,
      { id: 'machining', parentId: null, name: '加工', sortOrder: 2 },
      { id: 'cutting', parentId: 'machining', name: '切削', sortOrder: 0 },
      { id: 'grinding', parentId: 'machining', name: '研削', sortOrder: 1 }
    ]);
    mocks.blank.mockResolvedValue({ id: 'new-document' });
    render(<MemoryRouter><Routes><Route path="/" element={<ProcedureManualBrowser />} /><Route path="/kiosk/assembly/procedure-documents/:id/edit" element={<p>新規エディタ</p>} /></Routes></MemoryRouter>);
    await screen.findByRole('button', { name: 'DFD1' });
    fireEvent.click(screen.getByRole('button', { name: '白紙から作る' }));
    const dialog = screen.getByRole('dialog', { name: '白紙から作る' });
    fireEvent.change(within(dialog).getByLabelText('型番で検索'), { target: { value: 'ｄｆｄ９' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /DFD\s*9/ }));
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
  });

  it('shows model search, then processes, then the assigned sequence and missing-publication notice', async () => {
    mocks.detail.mockResolvedValue({
      ...emptyDetail,
      assignments: [{ id: 'missing', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', sortOrder: 1, label: '検査資料', unavailableReason: 'no_published_revision', resolvedDocumentId: null }],
      sequence: { ...emptyDetail.sequence, documents: [{ orderItemId: 'one', assemblyProcedureDocumentId: 'doc', title: '表示手順', lastApproval: { employeeName: '承認太郎', positionName: '班長', approvedAt: '2026-10-05T09:00:00Z' } }] }
    });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'DFD1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '組立工程 › 組立工程' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('機種検索'), { target: { value: 'ｄｆｄ１' } });
    expect(screen.queryByRole('button', { name: 'DFD2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /DFD\s*1/ }));
    fireEvent.click(await screen.findByRole('button', { name: '組立工程 › 組立工程' }));
    expect(await screen.findByTestId('sequence-viewer')).toHaveTextContent('表示手順');
    expect(screen.getByTestId('sequence-viewer')).toHaveAttribute('data-layout', 'manuals');
    expect(screen.getByRole('region', { name: '承認・動画' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('検査資料: 公開版なし')).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledWith('DFD1', 'assembly');
    expect(screen.queryByRole('button', { name: '現在の丸数字へ' })).not.toBeInTheDocument();
    expect(await screen.findByText(/承認: 承認太郎\(班長\)/)).toBeInTheDocument();
  });

  it('shows an empty model list and keeps the creation entry available', async () => {
    mocks.models.mockResolvedValue([]);
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    expect(await screen.findByText('機種がありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '割り当て' })).toBeEnabled();
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
