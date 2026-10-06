import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { saveProcedureEditorAccess } from '../procedureEditorAccess';

import { ProcedureManualWorkshop } from './ProcedureManualWorkshop';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';

const mocks = vi.hoisted(() => ({ count: vi.fn(), list: vi.fn(), ingest: vi.fn(), file: vi.fn(), discard: vi.fn(), restore: vi.fn(), unplace: vi.fn(), knowledge: vi.fn(), knowledgeImage: vi.fn(), importKnowledge: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureVideos: async () => [],
  listProcedureManualModels: async () => [], listProcedureManualProcesses: async () => [],
  getProcedureManualAssignments: vi.fn(), listAssemblyProcedureDocumentSummaries: vi.fn(),
  getAssemblyProcedureDocumentRevisions: vi.fn(), getKioskDocuments: vi.fn(), replaceProcedureManualAssignments: vi.fn(),
  listProcedureMaterials: (params: { q?: string }) => params.q === undefined ? mocks.count(params) : mocks.list(params), ingestProcedureMaterialsGmail: mocks.ingest, getProcedureMaterialFile: mocks.file,
  listProcedureKnowledgeCandidates: mocks.knowledge, getProcedureKnowledgeImage: mocks.knowledgeImage, importProcedureKnowledge: mocks.importKnowledge,
  discardProcedureMaterial: mocks.discard, restoreProcedureMaterial: mocks.restore, unplaceProcedureMaterial: mocks.unplace,
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({ AssemblyProcedureSequenceViewer: () => null }));
const text = { origin: 'GMAIL', id: 'text', kind: 'TEXT', text: '締付手順\n二行目\n三行目', subjectHint: 'DFD1 組立', fromEmail: 'sender@example.com', receivedAt: '2026-10-05T03:00:00Z', discardedAt: null, placedAt: null, documentId: null };
const photo = { ...text, id: 'photo', kind: 'PHOTO', text: null, originalFileName: '手順.png' };

describe('procedure-manuals material shelf', () => {
  beforeEach(() => {
    vi.resetAllMocks(); localStorage.clear(); saveProcedureEditorAccess('2520'); mocks.count.mockResolvedValue([]); mocks.list.mockResolvedValue([text, photo]); mocks.file.mockResolvedValue(new Blob(['photo'], { type: 'image/png' }));
    mocks.ingest.mockResolvedValue({ saved: 2, duplicate: 0, skipped: 1, retryable: 0, skippedAttachments: 1, messages: [{ messageId: 'unsupported', reason: '本文が空で、対応する写真がありません' }] });
    mocks.knowledge.mockResolvedValue({ enabled: false, items: [] });
    mocks.knowledgeImage.mockResolvedValue(new Blob(['knowledge']));
    mocks.importKnowledge.mockResolvedValue({ imported: 2, duplicate: 0, failed: [] });
    mocks.discard.mockResolvedValue(undefined); mocks.restore.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('opens the shelf from the workshop, shows text/photo metadata, filters hints, and manually ingests/reloads', async () => {
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    expect(await screen.findByText(/締付手順/)).toHaveClass('line-clamp-6');
    expect(await screen.findByRole('img', { name: '手順.png' })).toHaveAttribute('src', 'blob:photo');
    expect(screen.getAllByText('DFD1 組立')).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 500 });
    fireEvent.change(screen.getByLabelText('素材のヒント検索'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ state: 'unplaced', q: 'DFD1', limit: 500 }));
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText(/取込 2件/)).toBeInTheDocument(); expect(screen.getByText('本文が空で、対応する写真がありません')).toBeInTheDocument();
    expect(mocks.ingest).toHaveBeenCalledOnce(); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('button', { name: '現在ページに配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('fetches only visible photos once and disconnects observers/revokes URLs on close', async () => {
    const observers: Array<{ notify: (visible: boolean) => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ notify: (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver), observe: this.observe, disconnect: this.disconnect });
      }
    });
    mocks.list.mockResolvedValue([photo, { ...photo, id: 'offscreen', originalFileName: '範囲外.png' }]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(observers[0]!.observe).toHaveBeenCalledOnce();
    expect(mocks.file).not.toHaveBeenCalled();
    act(() => { observers[0]!.notify(false); });
    expect(mocks.file).not.toHaveBeenCalled();
    act(() => { observers[0]!.notify(true); observers[0]!.notify(true); });
    expect(await screen.findByRole('img', { name: '手順.png' })).toBeInTheDocument();
    expect(mocks.file).toHaveBeenCalledExactlyOnceWith('photo');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:photo');
  });
  it('does not create an object URL if a photo response arrives after closing', async () => {
    let resolve: (blob: Blob) => void = () => undefined;
    mocks.file.mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    mocks.list.mockResolvedValue([photo]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await waitFor(() => expect(mocks.file).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => { resolve(new Blob(['photo'])); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('discards then lists discarded materials and restores them', async () => {
    mocks.list.mockResolvedValueOnce([text]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, discardedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.click(screen.getByRole('button', { name: '捨てる' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '素材を捨てる' })).getByRole('button', { name: '捨てる' }));
    await screen.findByText('素材がありません'); expect(mocks.discard).toHaveBeenCalledWith('text');
    fireEvent.click(screen.getByRole('button', { name: '捨てた素材' }));
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('text'));
    await screen.findByText('素材がありません'); expect(mocks.list).toHaveBeenLastCalledWith({ state: 'discarded', q: '', limit: 500 });
  });
  it('selects only unplaced materials with the existing hint filter and keeps placement failures visible', async () => {
    mocks.list.mockResolvedValue([text]);
    const onSelect = vi.fn().mockRejectedValueOnce(new Error('配置エラー')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 500 });
    expect(screen.queryByRole('tab', { name: /^配置済み/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'DFD1 組立' }));
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('配置エラー');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledWith(text);
  });
  it('returns placed materials to the shelf through the placed tab', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, documentId: 'document', placedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await screen.findByText('素材がありません');
    fireEvent.click(screen.getByRole('tab', { name: /^配置済み/ }));
    fireEvent.click(await screen.findByRole('button', { name: '配置を取り消す' }));
    await waitFor(() => expect(mocks.unplace).toHaveBeenCalledWith('text'));
    expect(mocks.list).toHaveBeenCalledWith({ state: 'placed', q: '', limit: 500 });
  });
  it('lists, searches, selects knowledge text/photo and imports them into unplaced materials', async () => {
    const candidates = [
      { candidateKey: 'knowledge:text', kind: 'TEXT', title: 'Chat 素材', summary: '整理した要約', preview: '投稿本文', sourceLabel: 'Chat 投稿', alreadyImported: false },
      { candidateKey: 'knowledge:photo', kind: 'PHOTO', imageId: 'image-1', title: '手順写真', preview: '写真の説明', sourceLabel: '手順書: 組立', alreadyImported: false },
      { candidateKey: 'knowledge:old', kind: 'TEXT', title: '古い素材', preview: '保存済み', sourceLabel: 'Chat 投稿', alreadyImported: true },
    ];
    mocks.knowledge.mockResolvedValue({ enabled: true, items: candidates });
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([{ ...text, origin: 'KNOWLEDGE', text: '取り込んだ本文' }]);
    const onSelect = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} onSelect={onSelect} />);
    await screen.findByText('素材がありません');
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    expect(await screen.findByText('投稿本文')).toBeInTheDocument();
    expect(screen.getByText('整理した要約')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '手順写真' })).toBeInTheDocument();
    expect(mocks.knowledgeImage).toHaveBeenCalledWith('image-1');
    expect(screen.getByText('手順書: 組立')).toBeInTheDocument();
    expect(screen.getByText('写真の説明')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '古い素材' })).toBeDisabled();
    expect(screen.getByText(/取込済み/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚に取り込む' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('ナレッジ検索'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.knowledge).toHaveBeenLastCalledWith({ q: 'DFD1', limit: 100 }));
    await screen.findByRole('checkbox', { name: 'Chat 素材' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chat 素材' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '手順写真' }));
    fireEvent.click(screen.getByRole('button', { name: '棚に取り込む' }));
    expect(await screen.findByText('取り込んだ本文')).toBeInTheDocument();
    expect(mocks.importKnowledge).toHaveBeenCalledExactlyOnceWith(['knowledge:text', 'knowledge:photo']);
    expect(screen.getByRole('tab', { name: /^未配置/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('ナレッジ')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '現在ページに配置' })).toBeInTheDocument();
  });
  it('shows a short disabled message in the knowledge tab without image requests', async () => {
    mocks.list.mockResolvedValue([]);
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    expect(await screen.findByText('ナレッジ機能は無効です')).toBeInTheDocument();
    expect(mocks.knowledgeImage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '棚に取り込む' })).toBeDisabled();
  });
  it('fetches only visible knowledge photos and releases their URLs on tab switch', async () => {
    const observers: Array<{ notify: () => void }> = [];
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ notify: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) });
      }
    });
    mocks.list.mockResolvedValue([]);
    mocks.knowledge.mockResolvedValue({ enabled: true, items: ['first', 'offscreen'].map((id) => ({ candidateKey: id, kind: 'PHOTO', imageId: id, title: id, preview: '', sourceLabel: 'Chat 投稿', alreadyImported: false })) });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /^ナレッジから/ }));
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(mocks.knowledgeImage).not.toHaveBeenCalled();
    act(() => observers[0]!.notify());
    await screen.findByRole('img', { name: 'first' });
    expect(mocks.knowledgeImage).toHaveBeenCalledExactlyOnceWith('first');
    fireEvent.click(screen.getByRole('tab', { name: /^未配置/ }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
  it('switches 6/4/3 columns and remembers the terminal size, including unavailable storage', async () => {
    const view = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    await screen.findByText(/締付手順/);
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' });
    fireEvent.click(screen.getByRole('button', { name: '小' }));
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' });
    fireEvent.click(screen.getByRole('button', { name: '大' }));
    expect(screen.getByRole('list')).toHaveStyle({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
    view.unmount();
    const next = render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '大' })).toHaveAttribute('aria-pressed', 'true');
    next.unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ProcedureMaterialShelfDialog onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '中' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '小' }));
    expect(screen.getByRole('button', { name: '小' })).toHaveAttribute('aria-pressed', 'true');
    vi.restoreAllMocks();
  });
  it('places multiple materials in selection order and retains only unplaced selections after a failure', async () => {
    let finishFirst: () => void = () => undefined;
    const onSelect = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; })).mockRejectedValueOnce(new Error('写真の配置に失敗')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    const checks = await screen.findAllByRole('checkbox', { name: 'DFD1 組立' });
    fireEvent.click(checks[0]); fireEvent.click(checks[1]);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('2 件を選択中');
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(text);
    await act(async () => finishFirst());
    expect(await screen.findByRole('alert')).toHaveTextContent('写真の配置に失敗');
    expect(onSelect).toHaveBeenNthCalledWith(2, photo);
    expect(screen.getByRole('status', { name: '選択中の素材' })).toHaveTextContent('1 件を選択中');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '現在ページに配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenNthCalledWith(3, photo);
  });
  it('opens the original image without another fetch, then closes only the lightbox on Escape', async () => {
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} />);
    const zoom = await screen.findByRole('button', { name: '手順.pngを原寸表示' });
    await waitFor(() => expect(zoom).toBeEnabled());
    fireEvent.click(zoom);
    const lightbox = screen.getByRole('dialog', { name: '素材の原寸表示' });
    expect(within(lightbox).getByRole('img')).toHaveAttribute('src', 'blob:photo');
    expect(within(lightbox).getByRole('img')).toHaveClass('max-w-none');
    expect(mocks.file).toHaveBeenCalledOnce();
    fireEvent.click(within(lightbox).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog', { name: '素材の原寸表示' })).not.toBeInTheDocument();
    fireEvent.click(zoom);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '素材の原寸表示' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('shows write permission errors near the action controls', async () => {
    mocks.ingest.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualWorkshop /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: /^素材/ }));
    await screen.findByRole('button', { name: '今すぐ取り込む' });
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
  });
});
