import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearProcedureEditorAccess, readProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

import { ProcedureManualWorkshop } from './ProcedureManualWorkshop';

import type { ProcedureManualModelOverviewDto, ProcedureManualOverviewItemDto } from '../types';

const mocks = vi.hoisted(() => ({ models: vi.fn(), candidates: vi.fn(), processes: vi.fn(), overview: vi.fn(), detail: vi.fn(), replace: vi.fn(), delete: vi.fn(), materials: vi.fn(), videos: vi.fn(), image: vi.fn(), verify: vi.fn() }));
vi.mock('../../../api/client', () => ({
  verifyAssemblyTemplateAccessPassword: mocks.verify,
  listProcedureManualModels: mocks.models, listAssemblyMachineNameCandidates: mocks.candidates,
  listProcedureManualProcesses: mocks.processes, getProcedureManualModelOverview: mocks.overview,
  getProcedureManualAssignments: mocks.detail, replaceProcedureManualAssignments: mocks.replace,
  deleteAssemblyProcedureDocument: mocks.delete,
  listProcedureMaterials: mocks.materials, listProcedureVideos: mocks.videos
}));
vi.mock('../../../hooks/useProtectedImageBlobUrl', () => ({ useProtectedImageBlobUrl: mocks.image }));
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
const published: ProcedureManualOverviewItemDto = { assignmentId: 'pub', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId: 'v2', title: '公開手順', status: 'published', publishedRevisionNumber: 2, approval: null, draftRevision: null, unavailableReason: null, pageCount: 3, thumbnailPageUrl: '/page.png' };
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
  clearProcedureEditorAccess(); saveProcedureEditorAccess('2520');
  mocks.verify.mockResolvedValue({ success: true });
  vi.stubGlobal('IntersectionObserver', undefined);
  mocks.image.mockImplementation((url: string) => ({ blobUrl: url }));
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
afterEach(() => vi.unstubAllGlobals());

describe('procedure-manuals workshop', () => {
  it('skips the PIN dialog with valid access', () => {
    show(); expect(screen.queryByRole('dialog', { name: '暗証番号' })).not.toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('verifies at the entrance, stays on failure, and saves successful access', async () => {
    clearProcedureEditorAccess(); mocks.verify.mockResolvedValueOnce({ success: false });
    show(); expect(screen.getByRole('dialog', { name: '暗証番号' })).toBeInTheDocument();
    const pinDialog = screen.getByRole('dialog', { name: '暗証番号' });
    for (const digit of '2520') fireEvent.click(within(pinDialog).getByRole('button', { name: digit, exact: true }));
    expect(await screen.findByText('違います')).toBeInTheDocument();
    expect(readProcedureEditorAccess()).toBeNull();
    fireEvent.click(within(pinDialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '暗証番号' })).not.toBeInTheDocument());
    expect(mocks.verify).toHaveBeenCalledWith({ password: '2520' });
    expect(readProcedureEditorAccess()?.pin).toBe('2520');
  });
  it('returns to viewing when access has expired', () => {
    saveProcedureEditorAccess('2520', Date.now() - 8 * 60 * 60 * 1000);
    show(); fireEvent.click(screen.getByRole('button', { name: '見るへ戻る' }));
    expect(screen.getByTestId('location')).toHaveTextContent('"pathname":"/kiosk/assembly/manuals"');
  });
  it('shows the PIN gate at the deadline while the workshop stays mounted', async () => {
    vi.useFakeTimers();
    try {
      clearProcedureEditorAccess(); saveProcedureEditorAccess('2520'); show();
      await act(async () => {});
      act(() => vi.advanceTimersByTime(8 * 3600000));
      expect(screen.getByRole('dialog', { name: '暗証番号' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it.each(['visible', 'storage'])('rechecks access on %s', async trigger => {
    show(); await screen.findByRole('button', { name: '作る' });
    sessionStorage.removeItem('procedure-editor-access');
    act(() => {
      if (trigger === 'visible') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
      } else window.dispatchEvent(new StorageEvent('storage', { key: 'procedure-editor-access', storageArea: sessionStorage }));
    });
    expect(screen.getByRole('dialog', { name: '暗証番号' })).toBeInTheDocument();
  });
  it.each(['作る', '＋ 既存の要領書を割り当てる', '外す', '削除'])('rechecks expired access before %s', async action => {
    show(); await screen.findByRole('button', { name: '作る' });
    sessionStorage.removeItem('procedure-editor-access');
    fireEvent.click(screen.getAllByRole('button', { name: action })[0]);
    expect(screen.getByRole('dialog', { name: '暗証番号' })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  });
  it('starts image hooks only for visible rows and retains loaded thumbnails offscreen', async () => {
    const observers: { notify: (visible: boolean) => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const options: (IntersectionObserverInit | undefined)[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
        options.push(init);
        observers.push({ notify: visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver), observe: this.observe, disconnect: this.disconnect });
      }
    });
    const lazyItems = [published, { ...published, assignmentId: 'second', title: '画面外手順', thumbnailPageUrl: '/second.png' }];
    mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: 2, items: lazyItems }] });
    const view = show();
    const first = await screen.findByRole('row', { name: '公開手順' });
    const second = screen.getByRole('row', { name: '画面外手順' });
    expect(observers).toHaveLength(2);
    expect(options).toEqual([{ rootMargin: '200px' }, { rootMargin: '200px' }]);
    expect(observers[0].observe).toHaveBeenCalledWith(within(first).getAllByRole('cell')[0].firstChild);
    act(() => observers.forEach(observer => observer.notify(false)));
    expect(mocks.image).not.toHaveBeenCalled();
    act(() => observers[0].notify(true));
    const image = within(first).getByRole('img');
    expect(image).toHaveAttribute('src', '/page.png');
    expect(mocks.image).toHaveBeenCalledTimes(1);
    expect(mocks.image).toHaveBeenCalledWith('/page.png');
    expect(within(second).queryByRole('img')).not.toBeInTheDocument();
    expect(observers[0].disconnect).toHaveBeenCalled();
    act(() => observers[0].notify(false));
    expect(within(first).getByRole('img')).toBe(image);
    expect(mocks.image).toHaveBeenCalledTimes(1);
    act(() => observers[1].notify(true));
    expect(within(second).getByRole('img')).toHaveAttribute('src', '/second.png');
    view.unmount();
    expect(observers[1].disconnect).toHaveBeenCalled();
  });

  it('starts image hooks immediately without IntersectionObserver', async () => {
    show();
    const row = await screen.findByRole('row', { name: '公開手順' });
    expect(within(row).getByRole('img')).toHaveAttribute('src', '/page.png');
    expect(mocks.image).toHaveBeenCalledWith('/page.png');
  });

  it('exposes six visually hidden column headers and reads the page count with its unit', async () => {
    show();
    const row = await screen.findByRole('row', { name: '公開手順' });
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map(header => header.textContent)).toEqual(['サムネイル', '名前', '状態', '担当・承認', 'ページ', '操作']);
    expect(headers[0].parentElement).toHaveClass('sr-only');
    const cell = within(row).getAllByRole('cell')[4];
    expect(cell.textContent).toBe('3 ページ');
    expect(within(cell).getByText('ページ')).toHaveClass('sr-only');
  });

  it('shows published approval with MM/DD, leaves missing approvals blank and prioritizes a revision', async () => {
    const approval = { employeeName: '承認太郎', positionName: null, approvedAt: '2026-10-05T00:00:00Z' };
    const approvalItems = [{ ...published, approval }, { ...items[0], assignmentId: 'revision', title: '改版手順', approval }, { ...published, assignmentId: 'missing', title: '承認なし' }];
    mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: 3, items: approvalItems }] });
    show();
    const row = await screen.findByRole('row', { name: '公開手順' });
    expect(within(row).getByText('承認 承認太郎 10/05')).toBeInTheDocument();
    const revision = screen.getByRole('row', { name: '改版手順' });
    expect(within(revision).getByText(/改版中 · 佐藤/)).toBeInTheDocument();
    expect(within(revision).queryByText(/承認/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: '承認なし' })).getAllByRole('cell')[3]).toBeEmptyDOMElement();
  });

  it('uses dense accessible rows, status colors, thumbnails and valid symbol actions', async () => {
    show();
    expect(screen.getByTestId('procedure-manuals-workshop')).toHaveClass('grid-rows-[64px_minmax(0,1fr)]');
    const modelColumn = screen.getByRole('region', { name: '機種一覧' });
    const split = modelColumn.parentElement;
    expect(split).toHaveClass('grid-cols-[460px_minmax(0,1fr)]');
    expect(split?.children).toHaveLength(2);
    expect(split?.lastElementChild).toBe(screen.getByRole('region', { name: '要領書一覧' }));
    const processList = within(modelColumn).getByRole('region', { name: '工程一覧' });
    const tenkey = within(modelColumn).getByRole('group', { name: '機種テンキー' });
    expect(tenkey.parentElement).toBe(processList.parentElement);
    expect(tenkey.parentElement).toHaveClass('grid-cols-[200px_minmax(0,1fr)]');
    for (const key of within(tenkey).getAllByRole('button')) expect(key).toHaveClass('h-[52px]');
    expect(await screen.findByRole('button', { name: 'DFD1' })).toHaveAttribute('aria-current', 'true');
    const model = within(modelColumn).getByRole('button', { name: 'DFD1' });
    expect(model).toHaveClass('font-mono', 'text-[18px]');
    expect(model.parentElement).toBe(modelColumn);
    expect(tenkey.parentElement?.nextElementSibling).toBe(model);
    expect(screen.getByRole('heading', { name: 'DFD1 › 組立 › 組立' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'DFD1' })).toHaveLength(1);
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: '組立 › 組立 4' })).toHaveAttribute('aria-current', 'true');
    for (const process of within(processList).getAllByRole('button')) expect(process).toHaveClass('min-h-[46px]');
    expect(screen.getByRole('button', { name: '組立 › 検査 —' })).toBeInTheDocument();
    const pub = screen.getByRole('row', { name: '公開手順' });
    expect(pub).toHaveClass('h-14');
    expect(within(pub).getAllByRole('cell')).toHaveLength(6);
    expect(within(pub).getByText('公開手順')).toHaveAttribute('title', '公開手順');
    expect(within(pub).getByText('公開手順')).toHaveClass('font-mono', 'truncate');
    expect(within(pub).getByText('公開 第2版')).toHaveClass('text-[#3ba776]');
    expect(within(pub).getByText('改版中 · 佐藤 09:12〜')).toHaveClass('bg-[#f6b93b1f]');
    expect(within(pub).getByText('3')).toBeInTheDocument();
    expect(within(pub).getByRole('img')).toHaveAttribute('src', '/page.png');
    expect(within(pub).getByRole('img').parentElement).toHaveClass('h-[26px]', 'w-9');
    expect(within(pub).getByRole('link', { name: '使う' })).toHaveAttribute('href', '/kiosk/assembly/templates/new?procedureDocumentId=v2');
    const draft = screen.getByRole('row', { name: '初版下書き' });
    expect(within(draft).getByText('下書き')).toHaveClass('text-[#f6b93b]');
    expect(within(draft).getByRole('button', { name: '直す' })).toBeInTheDocument();
    expect(within(draft).queryByRole('link', { name: '使う' })).not.toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: '削除' })).toBeInTheDocument();
    for (const name of ['公開手順', '無効手順', 'キオスクPDF']) expect(within(screen.getByRole('row', { name })).queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
    for (const name of ['無効手順', 'キオスクPDF']) expect(within(screen.getByRole('row', { name })).queryByRole('button', { name: '直す' })).not.toBeInTheDocument();
    for (const name of ['無効手順', 'キオスクPDF']) {
      const row = screen.getByRole('row', { name });
      expect(within(row).queryByRole('img')).not.toBeInTheDocument();
      expect(within(row).queryByRole('link', { name: '使う' })).not.toBeInTheDocument();
      expect(within(row).getByRole('button', { name: '外す' })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('row', { name: '無効手順' })).getByText('—')).toBeInTheDocument();
    for (const control of [within(pub).getByRole('button', { name: '直す' }), within(pub).getByRole('link', { name: '使う' }), within(pub).getByRole('button', { name: '外す' }), within(draft).getByRole('button', { name: '削除' })]) {
      expect(control).toHaveClass('h-11', 'w-11');
      expect(control).toHaveAttribute('aria-label');
      expect(control.textContent).toBe('');
      expect(control.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(pub).getByRole('button', { name: '直す' })).toHaveClass('!border-[#f6b93b]');
    expect(screen.getByRole('button', { name: '＋ 既存の要領書を割り当てる' })).toHaveClass('min-h-12', 'border-dashed');
    expect(screen.getByText('無効')).toHaveClass('text-[#e5484d]');
  });

  it('filters all, published, initial drafts and revisions without requesting the API again', async () => {
    const filterItems = [...items, { ...published, assignmentId: 'stable', title: '公開済み手順' }];
    mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: filterItems.length, items: filterItems }] });
    show();
    await screen.findByRole('row', { name: '公開済み手順' });
    const group = within(screen.getByRole('group', { name: '状態で絞り込み' }));
    const table = within(screen.getByRole('table', { name: '組立 › 組立' }));
    const expected = {
      全て: ['公開手順', '初版下書き', '無効手順', 'キオスクPDF', '公開済み手順'],
      公開: ['公開手順', 'キオスクPDF', '公開済み手順'],
      下書き: ['初版下書き'],
      改版中: ['公開手順']
    };
    for (const [filter, names] of Object.entries(expected)) {
      fireEvent.click(group.getByRole('button', { name: filter }));
      expect(table.getAllByRole('row').filter(row => row.hasAttribute('aria-label')).map(row => row.getAttribute('aria-label'))).toEqual(names);
      expect(screen.getByText(`${names.length} 件`)).toBeInTheDocument();
      for (const button of group.getAllByRole('button')) {
        expect(button).toHaveClass('h-11');
        expect(button).toHaveAttribute('aria-pressed', String(button.textContent === filter));
      }
    }
    fireEvent.click(group.getByRole('button', { name: '全て' }));
    expect(table.getAllByRole('row')).toHaveLength(6);
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(mocks.models).toHaveBeenCalledTimes(1);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });

  it('filters displayed names immediately, normalizes case and width, and combines status and name', async () => {
    const labeledItems = items.map(item => item.assignmentId === 'pub' ? { ...item, label: 'DFD_ＡＢＣ_改版' } : item);
    mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: labeledItems.length, items: labeledItems }] });
    show();
    const row = await screen.findByRole('row', { name: 'DFD_ＡＢＣ_改版' });
    expect(within(row).getByText('DFD_ＡＢＣ_改版')).toHaveAttribute('title', 'DFD_ＡＢＣ_改版');
    const input = screen.getByRole('searchbox', { name: '名前で絞り込み' });
    expect(input).toHaveClass('w-[260px]', 'h-11');
    fireEvent.change(input, { target: { value: ' abc ' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '下書き' }));
    expect(screen.queryByRole('cell')).not.toBeInTheDocument();
    expect(screen.getByText('0 件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ 既存の要領書を割り当てる' })).toBeEnabled();
    fireEvent.change(input, { target: { value: '初版' } });
    expect(screen.getByRole('row', { name: '初版下書き' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全て' }));
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });

  it('shows a revision with no holder and omits unavailable approval and shared-model data', async () => {
    mocks.overview.mockResolvedValue({ ...overview, processes: [{ processId: 'assembly', count: 1, items: [{ ...published, draftRevision: { documentId: 'v3', revisionNumber: 3, editLease: null } }] }] });
    show();
    const row = await screen.findByRole('row', { name: '公開手順' });
    expect(within(row).getByText('改版中')).toHaveClass('bg-[#f6b93b1f]');
    expect(within(row).queryByText(/承認|共通 ·|〜/)).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
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
    expect(within(screen.getByRole('region', { name: '要領書一覧' })).getByText('機種を選択')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    expect(screen.getByText('工程を選択')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '組立 › 検査 —' }));
    expect(await screen.findByRole('heading', { name: 'DFD1 › 組立 › 検査' })).toBeInTheDocument();
    expect(screen.queryByRole('cell')).not.toBeInTheDocument();
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
    const pub = await screen.findByRole('row', { name: '公開手順' });
    fireEvent.click(within(pub).getByRole('button', { name: '直す' }));
    expect(JSON.parse(screen.getByTestId('location').textContent!)).toMatchObject({ pathname: `/kiosk/assembly/procedure-documents/${draft ? 'v3' : 'v2'}/edit`, state: {
      returnTo: '/kiosk/assembly/manuals/workshop?model=DFD1&process=assembly', context: { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立 › 組立', mode: 'fix' }
    } });
  });

  it('confirms removal once, preserves root references and labels, and refreshes counts', async () => {
    show(); const pub = await screen.findByRole('row', { name: '公開手順' });
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
    show(); const draft = await screen.findByRole('row', { name: '初版下書き' });
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
    show(); const draft = await screen.findByRole('row', { name: '初版下書き' });
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
    await waitFor(() => expect(screen.queryByRole('row', { name: '初版下書き' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    if (outcome === '409') expect(screen.getByRole('alert')).toHaveTextContent('テンプレートで使用中の手順書は削除できません。文書は未割り当てのまま残っています。');
    else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cancels deletion and does not DELETE if unassigning fails', async () => {
    mocks.replace.mockRejectedValue(new Error('外せません'));
    show(); const draft = await screen.findByRole('row', { name: '初版下書き' });
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
    show(); const pub = await screen.findByRole('row', { name: '公開手順' });
    fireEvent.click(within(pub).getByRole('button', { name: '外す' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '外す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('外せません');
    fireEvent.click(await screen.findByRole('button', { name: '素材 2' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材' })).getByRole('button', { name: '閉じる' }));
    fireEvent.click(await screen.findByRole('button', { name: '動画 1' }));
    expect(screen.getByRole('dialog', { name: '動画' })).toBeInTheDocument();
  });
});
