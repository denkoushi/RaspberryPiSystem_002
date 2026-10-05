import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { ProcedureManualBrowser } from './ProcedureManualBrowser';
import { ProcedureMaterialShelfDialog } from './ProcedureMaterialShelfDialog';

const mocks = vi.hoisted(() => ({ list: vi.fn(), ingest: vi.fn(), file: vi.fn(), discard: vi.fn(), restore: vi.fn(), unplace: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureManualModels: async () => [], listProcedureManualProcesses: async () => [],
  getProcedureManualAssignments: vi.fn(), listAssemblyProcedureDocumentSummaries: vi.fn(),
  getAssemblyProcedureDocumentRevisions: vi.fn(), getKioskDocuments: vi.fn(), replaceProcedureManualAssignments: vi.fn(),
  listProcedureMaterials: mocks.list, ingestProcedureMaterialsGmail: mocks.ingest, getProcedureMaterialFile: mocks.file,
  discardProcedureMaterial: mocks.discard, restoreProcedureMaterial: mocks.restore, unplaceProcedureMaterial: mocks.unplace,
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({ AssemblyProcedureSequenceViewer: () => null }));
const text = { id: 'text', kind: 'TEXT', text: '締付手順\n二行目\n三行目', subjectHint: 'DFD1 組立', fromEmail: 'sender@example.com', receivedAt: '2026-10-05T03:00:00Z', discardedAt: null, placedAt: null, documentId: null };
const photo = { ...text, id: 'photo', kind: 'PHOTO', text: null, originalFileName: '手順.png' };

describe('procedure-manuals material shelf', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.list.mockResolvedValue([text, photo]); mocks.file.mockResolvedValue(new Blob(['photo'], { type: 'image/png' }));
    mocks.ingest.mockResolvedValue({ saved: 2, duplicate: 0, skipped: 1, retryable: 0, skippedAttachments: 1, messages: [{ messageId: 'unsupported', reason: '本文が空で、対応する写真がありません' }] });
    mocks.discard.mockResolvedValue(undefined); mocks.restore.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('opens the shelf from the browser, shows text/photo metadata, filters hints, and manually ingests/reloads', async () => {
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    expect(screen.getByRole('dialog', { name: '素材' })).toBeInTheDocument();
    expect(await screen.findByText(/締付手順/)).toHaveClass('line-clamp-2');
    expect(await screen.findByRole('img', { name: '手順.png' })).toHaveAttribute('src', 'blob:photo');
    expect(screen.getAllByText('DFD1 組立')).toHaveLength(2); expect(screen.getAllByText(/sender@example.com/)).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 40 });
    fireEvent.change(screen.getByLabelText('素材のヒント検索'), { target: { value: 'DFD1' } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ state: 'unplaced', q: 'DFD1', limit: 40 }));
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByText(/取込 2件/)).toBeInTheDocument(); expect(screen.getByText('本文が空で、対応する写真がありません')).toBeInTheDocument();
    expect(mocks.ingest).toHaveBeenCalledOnce(); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('button', { name: '配置' })).not.toBeInTheDocument();
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
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: '素材' }));
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
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await waitFor(() => expect(mocks.file).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await act(async () => { resolve(new Blob(['photo'])); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('discards then lists discarded materials and restores them', async () => {
    mocks.list.mockResolvedValueOnce([text]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, discardedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: '素材' }));
    fireEvent.click(await screen.findByRole('button', { name: '捨てる' }));
    await screen.findByText('素材がありません'); expect(mocks.discard).toHaveBeenCalledWith('text');
    fireEvent.click(screen.getByRole('button', { name: '捨てた素材' }));
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('text'));
    await screen.findByText('素材がありません'); expect(mocks.list).toHaveBeenLastCalledWith({ state: 'discarded', q: '', limit: 40 });
  });
  it('selects only unplaced materials with the existing hint filter and keeps placement failures visible', async () => {
    mocks.list.mockResolvedValue([text]);
    const onSelect = vi.fn().mockRejectedValueOnce(new Error('配置エラー')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ProcedureMaterialShelfDialog onClose={onClose} onSelect={onSelect} />);
    expect(mocks.list).toHaveBeenCalledWith({ state: 'unplaced', q: '', limit: 40 });
    expect(screen.queryByRole('button', { name: '配置済み' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('配置エラー');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledWith(text);
  });
  it('returns placed materials to the shelf through the placed tab', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...text, documentId: 'document', placedAt: '2026-10-05T04:00:00Z' }]).mockResolvedValueOnce([]);
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await screen.findByText('素材がありません');
    fireEvent.click(screen.getByRole('button', { name: '配置済み' }));
    fireEvent.click(await screen.findByRole('button', { name: '配置を取り消す' }));
    await waitFor(() => expect(mocks.unplace).toHaveBeenCalledWith('text'));
    expect(mocks.list).toHaveBeenCalledWith({ state: 'placed', q: '', limit: 40 });
  });
  it('shows write permission errors near the action controls', async () => {
    mocks.ingest.mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await screen.findByRole('button', { name: '今すぐ取り込む' });
    fireEvent.click(screen.getByRole('button', { name: '今すぐ取り込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません');
  });
});
