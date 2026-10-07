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

const mocks = vi.hoisted(() => ({ list: vi.fn(), file: vi.fn(), poster: vi.fn(), retry: vi.fn(), discard: vi.fn(), restore: vi.fn(), page: vi.fn(), save: vi.fn(), detail: vi.fn(), trim: vi.fn(), comments: vi.fn(), saveComments: vi.fn(), concat: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureVideos: mocks.list, getProcedureVideoFile: mocks.file, getProcedureVideoPoster: mocks.poster,
  retryProcedureVideo: mocks.retry, discardProcedureVideo: mocks.discard, restoreProcedureVideo: mocks.restore,
  trimProcedureVideo: mocks.trim, getProcedureVideoComments: mocks.comments, replaceProcedureVideoComments: mocks.saveComments,
  concatProcedureVideos: mocks.concat,
  getProcedurePageVideos: mocks.page, replaceProcedurePageVideos: mocks.save,
  listProcedureManualModels: async () => [{ modelCode: 'DFD1', modelCodeKey: 'DFD1' }],
  listProcedureManualProcesses: async () => [{ id: 'root', name: '組立工程', parentId: null }, { id: 'p', name: '検査工程', parentId: 'root' }],
  getProcedureManualModelOverview: async () => ({ modelCode: 'DFD1', modelCodeKey: 'DFD1', processes: [{ processId: 'p', count: 0, items: [] }] }),
  getProcedureManualAssignments: mocks.detail,
  listProcedureMaterials: async () => [],
}));
vi.mock('../AssemblyProcedureSequenceViewer', () => ({
  AssemblyProcedureSequenceViewer: ({ sequence, onCurrentPageChange, onCurrentStepChange }: { onCurrentStepChange?: (step: null, index: number, total: number) => void; sequence: AssemblyProcedureSequenceDto; onCurrentPageChange?: (page: AssemblyProcedureSequencePageDto | null) => void }) => {
    useEffect(() => { onCurrentPageChange?.(sequence.documents[0].pages?.[0] ?? null); onCurrentStepChange?.(null, 0, 2); }, [sequence, onCurrentPageChange, onCurrentStepChange]);
    return <button onClick={() => onCurrentPageChange?.(sequence.documents[0].pages?.[1] ?? null)}>次のページ</button>;
  }
}));
const ready: ProcedureVideoDto = { id: 'ready', title: '締付動画', origin: 'GMAIL', durationSeconds: 12, status: 'READY', hasPoster: true, linkCount: 0, errorCode: null, errorMessage: null, discardedAt: null };
const failed: ProcedureVideoDto = { ...ready, id: 'failed', title: '失敗動画', hasPoster: false, durationSeconds: null, status: 'FAILED', errorCode: 'TOO_LONG', errorMessage: '動画は60秒までです' };
const pending: ProcedureVideoDto = { ...failed, id: 'pending', title: '受付動画', status: 'PENDING', errorCode: null, errorMessage: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([ready, failed, pending]); mocks.page.mockResolvedValue([]); mocks.save.mockResolvedValue([]);
  mocks.comments.mockResolvedValue([]); mocks.trim.mockResolvedValue(undefined); mocks.saveComments.mockResolvedValue([]);
  mocks.file.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' })); mocks.poster.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => blob.type === 'video/mp4' ? 'blob:video' : 'blob:poster');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('procedure-manuals videos', () => {
  it('selects READY videos, opens concat, reorders lengths/default title and submits before showing the pending result and origin badge', async () => {
    const second = { ...ready, id: 'second', title: '確認動画', durationSeconds: 3 };
    const discarded = { ...ready, id: 'discarded', title: '破棄動画', discardedAt: '2026-10-05' };
    mocks.list.mockResolvedValue([ready, second, failed, pending, discarded]);
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    const button = await screen.findByRole('button', { name: '接続', exact: true });
    expect(button).toBeDisabled();
    await screen.findByText('締付動画');
    expect(screen.queryByRole('checkbox', { name: '失敗動画を接続用に選択' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '受付動画を接続用に選択' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '破棄動画を接続用に選択' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '締付動画を接続用に選択' })); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '確認動画を接続用に選択' })); expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: '動画の接続' })).toBeInTheDocument();
    expect(screen.getByText('1. 締付動画（12.0秒）')).toBeInTheDocument();
    expect(screen.getByText('2. 確認動画（3.0秒）')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '合計の長さ' })).toHaveTextContent('合計 15.0秒');
    expect(screen.getByText('紐づけにはトリミングが必要')).toHaveClass('text-red-700');
    expect(screen.getByRole('textbox', { name: '接続動画の題名' })).toHaveValue('締付動画 ほか 1 本');
    fireEvent.click(screen.getByRole('button', { name: '確認動画を上へ' }));
    expect(screen.getByText('1. 確認動画（3.0秒）')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '接続動画の題名' })).toHaveValue('確認動画 ほか 1 本');
    fireEvent.click(screen.getByRole('button', { name: '確認動画を下へ' }));
    fireEvent.click(screen.getByRole('button', { name: '確認動画を上へ' }));
    fireEvent.change(screen.getByRole('textbox', { name: '接続動画の題名' }), { target: { value: ' 接続結果 ' } });
    mocks.list.mockResolvedValue([{ ...pending, id: 'concat', title: '接続結果', origin: 'CONCAT' }, ready, second]);
    mocks.concat.mockResolvedValue({ id: 'concat', status: 'PENDING', origin: 'CONCAT' });
    fireEvent.click(screen.getByRole('button', { name: '接続する' }));
    await waitFor(() => expect(mocks.concat).toHaveBeenCalledExactlyOnceWith(['second', 'ready'], '接続結果'));
    const result = (await screen.findByText('接続結果')).closest('article')!;
    expect(within(result).getByText('接続')).toBeInTheDocument();
    expect(within(result).getByText('長さ未確認 · 処理中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接続', exact: true })).toBeDisabled();
  });
  it('keeps A selected across a search, selects B and sends both in selection order', async () => {
    const second = { ...ready, id: 'second', title: '確認動画', durationSeconds: 3 };
    mocks.list.mockImplementation(async ({ q }) => q ? [second] : [ready]);
    mocks.concat.mockResolvedValue({ id: 'concat', status: 'PENDING', origin: 'CONCAT' });
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '締付動画を接続用に選択' }));
    fireEvent.change(screen.getByRole('textbox', { name: '動画検索' }), { target: { value: '確認' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: '確認動画を接続用に選択' }));
    expect(screen.queryByRole('checkbox', { name: '締付動画を接続用に選択' })).not.toBeInTheDocument();
    expect(screen.getByText('2 本を選択中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '接続', exact: true }));
    expect(screen.getByText('1. 締付動画（12.0秒）')).toBeInTheDocument();
    expect(screen.getByText('2. 確認動画（3.0秒）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '接続する' }));
    await waitFor(() => expect(mocks.concat).toHaveBeenCalledExactlyOnceWith(['ready', 'second'], undefined));
  });
  it('clears hidden selections with the button beside search', async () => {
    mocks.list.mockImplementation(async ({ q }) => q ? [] : [ready]);
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '締付動画を接続用に選択' }));
    fireEvent.change(screen.getByRole('textbox', { name: '動画検索' }), { target: { value: '別の動画' } });
    await screen.findByText('動画がありません');
    expect(screen.getByText('1 本を選択中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }));
    expect(screen.getByText('0 本を選択中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '選択を解除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '接続', exact: true })).toBeDisabled();
  });
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
    const close = vi.fn(); render(<ProcedureVideoShelfDialog onClose={close} link={{ documentId: 'doc', pageIndex: 2, accessPassword: 'password', holderToken: 'session-token' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '紐づけを保存' })).toBeEnabled());
    const card = (await screen.findByText('締付動画')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '締付動画を上へ' }));
    fireEvent.click(screen.getByRole('button', { name: '紐づけを保存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('doc', 2, ['ready', 'pending'], 'password', 'session-token'));
    expect(close).toHaveBeenCalledOnce(); expect(mocks.page).toHaveBeenCalledWith('doc', 2);
  });
  it('shows READY thumbnails beneath the viewer for the current page and opens playback on tap', async () => {
    const pages = [
      { source: 'assembly_procedure_document', documentId: 'doc', pageIndex: 0, pageUrl: 'page', videos: [ready, pending] },
      { source: 'assembly_procedure_document', documentId: 'doc', pageIndex: 1, pageUrl: 'page2', videos: [] }
    ];
    mocks.detail.mockResolvedValue({ assignments: [], sequence: { documents: [{ assemblyProcedureDocumentId: 'doc', pages }] } });
    localStorage.setItem('procedure-manuals-list-open', 'true'); render(<MemoryRouter><ProcedureManualBrowser /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'DFD1' }));
    fireEvent.click(screen.getByRole('button', { name: '組立工程 › 検査工程' }));
    const strip = await screen.findByRole('region', { name: 'このページの動画' });
    expect(within(strip).getByRole('button', { name: '締付動画' })).toBeInTheDocument(); expect(within(strip).queryByText('受付動画')).not.toBeInTheDocument();
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
  it('moves both trim handles by drag/arrows/Shift and shows over-ten-second selections in red', async () => {
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'トリミング' }));
    const start = screen.getByRole('slider', { name: '開始秒' });
    const end = screen.getByRole('slider', { name: '終了秒' });
    expect(screen.getByRole('status', { name: '選択長さ' })).toHaveTextContent('10.0秒');
    fireEvent.change(end, { target: { value: '12' } });
    expect(screen.getByRole('status', { name: '選択長さ' })).toHaveTextContent('12.0秒');
    expect(screen.getByRole('status', { name: '選択長さ' })).toHaveClass('text-red-700');
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(start).toHaveValue('0.1');
    expect(start).toHaveAttribute('aria-valuenow', '0.1');
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    expect(start).toHaveValue('1.1');
    expect(start).toHaveAttribute('aria-valuenow', '1.1');
    fireEvent.keyDown(end, { key: 'ArrowLeft' });
    expect(end).toHaveAttribute('aria-valuenow', '11.9');
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(end).toHaveAttribute('aria-valuenow', '10.9');
    fireEvent.change(end, { target: { value: '12' } });
    fireEvent.change(start, { target: { value: '3' } });
    expect(screen.getByRole('status', { name: '選択長さ' })).toHaveTextContent('9.0秒');
    expect(screen.getByRole('status', { name: '選択長さ' })).not.toHaveClass('text-red-700');
    const player = await screen.findByLabelText('締付動画', { selector: 'video' }) as HTMLVideoElement;
    player.currentTime = 4.2; fireEvent.click(screen.getByRole('button', { name: '開始を現在位置に' }));
    expect(start).toHaveValue('4.2');
    player.currentTime = 8.3; fireEvent.click(screen.getByRole('button', { name: '終了を現在位置に' }));
    expect(end).toHaveValue('8.3');
  });
  it('lets each overlapping 44px thumb be selected and brings the focused handle to the front', async () => {
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'トリミング' }));
    const start = screen.getByRole('slider', { name: '開始秒' });
    const end = screen.getByRole('slider', { name: '終了秒' });
    for (const handle of [start, end]) {
      expect(handle).toHaveClass('[&::-webkit-slider-thumb]:h-11', '[&::-webkit-slider-thumb]:w-11', '[&::-moz-range-thumb]:h-11', '[&::-moz-range-thumb]:w-11');
    }
    fireEvent.change(start, { target: { value: '9.5' } });
    fireEvent.click(screen.getByRole('button', { name: '開始つまみを操作' }));
    expect(start).toHaveFocus(); expect(start).toHaveStyle({ zIndex: '2' }); expect(end).toHaveStyle({ zIndex: '1' });
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(start).toHaveAttribute('aria-valuenow', '9.4');
    fireEvent.click(screen.getByRole('button', { name: '終了つまみを操作' }));
    expect(end).toHaveFocus(); expect(end).toHaveStyle({ zIndex: '2' }); expect(start).toHaveStyle({ zIndex: '1' });
    fireEvent.keyDown(end, { key: 'ArrowRight', shiftKey: true });
    expect(end).toHaveAttribute('aria-valuenow', '11');
  });
  it('confirms irreversible trim before submission and returns to the processing shelf', async () => {
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'トリミング' }));
    fireEvent.click(screen.getByRole('button', { name: 'この範囲で切り出す' }));
    expect(mocks.trim).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'この範囲で切り出しますか' });
    expect(within(confirm).getByText(/元に戻す機能はありません/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'キャンセル' }));
    expect(mocks.trim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この範囲で切り出す' }));
    mocks.list.mockResolvedValue([{ ...ready, status: 'PENDING' }]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'この範囲で切り出しますか' })).getByRole('button', { name: '切り出す' }));
    await waitFor(() => expect(mocks.trim).toHaveBeenCalledExactlyOnceWith('ready', 0, 10));
    expect(await screen.findByText('12.0秒 · 処理中')).toBeInTheDocument();
  });
  it('adds a comment at the current position, edits/removes rows and saves at most five comments', async () => {
    mocks.comments.mockResolvedValue([{ atSeconds: 1, text: '既存' }]);
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'コメント' }));
    await screen.findByDisplayValue('既存');
    const player = await screen.findByLabelText('締付動画', { selector: 'video' }) as HTMLVideoElement;
    player.currentTime = 3.2;
    fireEvent.click(screen.getByRole('button', { name: '現在位置に追加' }));
    expect(screen.getByLabelText('コメント2の秒数')).toHaveValue(3.2);
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('コメント2の文'), { target: { value: 'ここで押す' } });
    expect(screen.getByLabelText('コメント2の文')).toHaveAttribute('maxlength', '80');
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '現在位置に追加' }));
    expect(screen.getByRole('button', { name: '現在位置に追加' })).toBeDisabled();
    for (let i = 5; i >= 3; i--) fireEvent.click(screen.getByRole('button', { name: `コメント${i}を削除` }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveComments).toHaveBeenCalledWith('ready', [{ atSeconds: 1, text: '既存' }, { atSeconds: 3.2, text: 'ここで押す' }]));
    expect(await screen.findByRole('dialog', { name: '動画' })).toBeInTheDocument();
  });
  it('shows captions from their time to the next comment or four seconds and seeks from the list', async () => {
    mocks.comments.mockResolvedValue([{ atSeconds: 1, text: '最初の場面' }, { atSeconds: 3, text: '次の場面' }]);
    render(<ProcedureVideoPlaybackDialog video={ready} onClose={vi.fn()} />);
    const player = await screen.findByLabelText('締付動画', { selector: 'video' }) as HTMLVideoElement;
    await screen.findByRole('button', { name: '0:01 最初の場面' });
    expect(screen.queryByTestId('video-caption')).not.toBeInTheDocument();
    player.currentTime = 1; fireEvent.timeUpdate(player);
    expect(screen.getByTestId('video-caption')).toHaveTextContent('最初の場面');
    player.currentTime = 3; fireEvent.timeUpdate(player);
    expect(screen.getByTestId('video-caption')).toHaveTextContent('次の場面');
    player.currentTime = 7; fireEvent.timeUpdate(player);
    expect(screen.queryByTestId('video-caption')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '0:01 最初の場面' }));
    expect(player.currentTime).toBe(1);
    expect(screen.getByTestId('video-caption')).toHaveTextContent('最初の場面');
  });

});
