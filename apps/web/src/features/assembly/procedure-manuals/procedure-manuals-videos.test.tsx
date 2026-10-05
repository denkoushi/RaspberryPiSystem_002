import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureManualBrowser } from './ProcedureManualBrowser';
import { ProcedureVideoPlaybackDialog } from './ProcedureVideoPlaybackDialog';
import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoDto } from './procedure-video-types';
import type { AssemblyProcedureSequenceDto, AssemblyProcedureSequencePageDto } from '../types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), file: vi.fn(), poster: vi.fn(), retry: vi.fn(), discard: vi.fn(), restore: vi.fn(), page: vi.fn(), save: vi.fn(), detail: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureVideos: mocks.list, getProcedureVideoFile: mocks.file, getProcedureVideoPoster: mocks.poster,
  retryProcedureVideo: mocks.retry, discardProcedureVideo: mocks.discard, restoreProcedureVideo: mocks.restore,
  getProcedurePageVideos: mocks.page, replaceProcedurePageVideos: mocks.save,
  listProcedureManualModels: async () => [{ modelCode: 'DFD1', modelCodeKey: 'DFD1' }],
  listProcedureManualProcesses: async () => [{ id: 'root', name: '組立工程', parentId: null }, { id: 'p', name: '検査工程', parentId: 'root' }],
  getProcedureManualAssignments: mocks.detail,
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ sequence, onCurrentPageChange }: { sequence: AssemblyProcedureSequenceDto; onCurrentPageChange?: (page: AssemblyProcedureSequencePageDto | null) => void }) => {
    useEffect(() => { onCurrentPageChange?.(sequence.documents[0].pages?.[0] ?? null); }, [sequence, onCurrentPageChange]);
    return <button onClick={() => onCurrentPageChange?.(sequence.documents[0].pages?.[1] ?? null)}>次のページ</button>;
  }
}));
const ready: ProcedureVideoDto = { id: 'ready', title: '締付動画', durationSeconds: 12, status: 'READY', hasPoster: true, linkCount: 0, errorCode: null, errorMessage: null, discardedAt: null };
const failed: ProcedureVideoDto = { ...ready, id: 'failed', title: '失敗動画', hasPoster: false, durationSeconds: null, status: 'FAILED', errorCode: 'TOO_LONG', errorMessage: '動画は60秒までです' };
const pending: ProcedureVideoDto = { ...failed, id: 'pending', title: '受付動画', status: 'PENDING', errorCode: null, errorMessage: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([ready, failed, pending]); mocks.page.mockResolvedValue([]); mocks.save.mockResolvedValue([]);
  mocks.file.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' })); mocks.poster.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => blob.type === 'video/mp4' ? 'blob:video' : 'blob:poster');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('procedure-manuals videos', () => {
  it('shows video title/length/status, retries failure, confirms discard, and restores discarded videos', async () => {
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    expect(await screen.findByText('締付動画')).toBeInTheDocument(); expect(screen.getByText('12.0秒 · 完了')).toBeInTheDocument();
    expect(screen.getByText('長さ未確認 · 失敗: 動画は60秒までです')).toBeInTheDocument();
    expect(screen.getByText('長さ未確認 · 処理中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' })); await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('failed'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '捨てる' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '捨てる' })[0]); expect(mocks.discard).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: '動画を捨てる' })).getByRole('button', { name: '捨てる' }));
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith('ready'));
    mocks.list.mockResolvedValue([{ ...ready, discardedAt: '2026-10-05' }]);
    fireEvent.click(screen.getByRole('button', { name: '捨てた動画' }));
    fireEvent.click(await screen.findByRole('button', { name: '戻す' })); await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('ready'));
  });
  it('opens playback from the shelf with controls/inline/muted and releases the Object URL on close', async () => {
    const rendered = render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '再生' }));
    const video = await waitFor(() => { const element = screen.getByLabelText('締付動画', { selector: 'video' }) as HTMLVideoElement; expect(element).toHaveAttribute('src', 'blob:video'); return element; });
    expect(video).toHaveAttribute('controls'); expect(video).toHaveAttribute('playsinline'); expect(video.muted).toBe(true); expect(video).toHaveAttribute('preload', 'metadata');
    expect(mocks.file).toHaveBeenCalledWith('ready', expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' })); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
    rendered.unmount();
  });
  it('loads page links, selects videos, reorders them and saves only the current page with the edit password', async () => {
    mocks.page.mockResolvedValue([pending]);
    const close = vi.fn(); render(<ProcedureVideoShelfDialog onClose={close} link={{ documentId: 'doc', pageIndex: 2, accessPassword: 'password' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '紐づけを保存' })).toBeEnabled());
    const card = (await screen.findByText('締付動画')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '締付動画を上へ' }));
    fireEvent.click(screen.getByRole('button', { name: '紐づけを保存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('doc', 2, ['ready', 'pending'], 'password'));
    expect(close).toHaveBeenCalledOnce(); expect(mocks.page).toHaveBeenCalledWith('doc', 2);
  });
  it('shows READY thumbnails beneath the viewer for the current page and opens playback on tap', async () => {
    const pages = [
      { source: 'assembly_procedure_document', documentId: 'doc', pageIndex: 0, pageUrl: 'page', videos: [ready, pending] },
      { source: 'assembly_procedure_document', documentId: 'doc', pageIndex: 1, pageUrl: 'page2', videos: [] }
    ];
    mocks.detail.mockResolvedValue({ assignments: [], sequence: { documents: [{ assemblyProcedureDocumentId: 'doc', pages }] } });
    render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    fireEvent.click(screen.getByRole('button', { name: '組立工程 > 検査工程' }));
    const strip = await screen.findByRole('region', { name: 'このページの動画' });
    expect(within(strip).getByText('締付動画')).toBeInTheDocument(); expect(within(strip).queryByText('受付動画')).not.toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: /締付動画/ }));
    await waitFor(() => expect(screen.getByLabelText('締付動画', { selector: 'video' })).toHaveAttribute('src', 'blob:video'));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));
    expect(screen.queryByRole('region', { name: 'このページの動画' })).not.toBeInTheDocument();
  });
  it('fetches only visible posters and releases them on unmount', async () => {
    let notify: (visible: boolean) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      observe = vi.fn(); disconnect = disconnect;
      constructor(callback: IntersectionObserverCallback) { notify = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    });
    const view = render(<ProcedureVideoThumbnail id="ready" title="締付動画" />);
    expect(mocks.poster).not.toHaveBeenCalled();
    act(() => { notify(false); }); expect(mocks.poster).not.toHaveBeenCalled();
    act(() => { notify(true); notify(true); });
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:poster'); expect(mocks.poster).toHaveBeenCalledOnce();
    view.unmount(); expect(disconnect).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster');
  });
  it('cancels a pending video download and creates no URL after closing', async () => {
    let resolve: (value: Blob) => void = () => undefined;
    mocks.file.mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    const view = render(<ProcedureVideoPlaybackDialog video={ready} onClose={vi.fn()} />);
    view.unmount(); expect(mocks.file.mock.calls[0][1].aborted).toBe(true);
    await act(async () => { resolve(new Blob(['mp4'])); }); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
