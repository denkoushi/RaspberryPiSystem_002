import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcedureVideoShelfDialog } from './ProcedureVideoShelfDialog';

import type { ProcedureVideoDto } from './procedure-video-types';
import type { ProcedureVideoAutoEditDto } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), apply: vi.fn(), dismiss: vi.fn(), regenerate: vi.fn(), comments: vi.fn(), file: vi.fn(), poster: vi.fn() }));
vi.mock('../../../api/client', () => ({
  listProcedureVideos: mocks.list, getProcedureVideoAutoEdit: mocks.get, applyProcedureVideoAutoEdit: mocks.apply,
  dismissProcedureVideoAutoEdit: mocks.dismiss, regenerateProcedureVideoAutoEdit: mocks.regenerate,
  getProcedureVideoComments: mocks.comments, getProcedureVideoFile: mocks.file, getProcedureVideoPoster: mocks.poster,
  getProcedurePageVideos: async () => [], getProcedureVideoScenes: async () => [],
}));
const row: ProcedureVideoAutoEditDto = {
  id: 'suggestion-1', videoId: 'v1', status: 'READY', decision: null, errorCode: null, errorMessage: null, confirmed: null, createdAt: '', updatedAt: '',
  suggestion: { scenes: [
    { title: '準備', startSeconds: 0, endSeconds: 5, caption: '位置を合わせる', needsReview: true },
    { title: '確認', startSeconds: 5, endSeconds: 12, caption: '手を離す' }
  ], comments: [] }
};
const video: ProcedureVideoDto = { id: 'v1', title: '組立動画', durationSeconds: 12, status: 'READY', hasPoster: true, origin: 'GMAIL', linkCount: 0, sceneCount: 0, errorCode: null, errorMessage: null, discardedAt: null, autoEdit: { status: 'READY', decision: null } };
const second: ProcedureVideoDto = { ...video, id: 'v2', title: '次の動画' };
const conflict = (message: string) => ({ response: { status: 409, data: { message } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([video, second]); mocks.get.mockResolvedValue(row); mocks.comments.mockResolvedValue([]);
  mocks.apply.mockResolvedValue(undefined); mocks.dismiss.mockResolvedValue(undefined);
  mocks.regenerate.mockResolvedValue({ ...row, id: 'suggestion-2', status: 'PENDING', suggestion: null });
  mocks.file.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' })); mocks.poster.mockResolvedValue(new Blob(['jpeg']));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = async () => {
  const view = render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
  await screen.findByRole('textbox', { name: '場面1の名前' });
  await waitFor(() => expect(screen.getByRole('button', { name: '採用', exact: true })).toBeEnabled());
  return view;
};

describe('procedure video AI desk', () => {
  it('edits READY scenes and sends suggestionId, captions and fallback scene names', async () => {
    await open();
    expect(screen.getByText('AIが分けた場面')).toBeInTheDocument(); expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('要確認')).toBeInTheDocument(); expect(screen.getByText('字幕の案')).toBeInTheDocument();
    expect(screen.getByLabelText('場面1の名前')).toHaveAttribute('maxlength', '20'); expect(screen.getByLabelText('場面1の字幕')).toHaveAttribute('maxlength', '80');
    fireEvent.change(screen.getByLabelText('場面1の名前'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('場面1の字幕'), { target: { value: '台に置く' } });
    fireEvent.change(screen.getByLabelText('場面2の字幕'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '採用', exact: true }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledExactlyOnceWith('v1', { suggestionId: 'suggestion-1', comments: [{ atSeconds: 0, text: '台に置く' }], scenes: [{ title: '場面 1', startSeconds: 0, endSeconds: 5 }, { title: '確認', startSeconds: 5, endSeconds: 12 }] }));
    expect(screen.queryByLabelText('場面1の名前')).not.toBeInTheDocument(); expect(screen.getByText('字幕')).toBeInTheDocument();
  });
  it('requires two presses for existing comments and disarms after edits', async () => {
    mocks.comments.mockResolvedValue([{ atSeconds: 1, text: '既存' }]);
    await open(); fireEvent.click(screen.getByRole('button', { name: '採用', exact: true }));
    expect(mocks.apply).not.toHaveBeenCalled(); expect(screen.getByText('今のコメント1件を、この字幕に置き換えます')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('場面1の字幕'), { target: { value: '直した字幕' } });
    expect(screen.queryByText('今のコメント1件を、この字幕に置き換えます')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '採用', exact: true })); fireEvent.click(screen.getByRole('button', { name: '置き換えて採用' }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledOnce());
  });
  it('disables adoption when existing comments cannot be loaded', async () => {
    mocks.comments.mockRejectedValue(new Error('コメント読込エラー'));
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('コメント読込エラー');
    expect(await screen.findByRole('button', { name: '採用', exact: true })).toBeDisabled();
  });
  it('prevents changing video or opening another editor while adoption is in flight', async () => {
    let finish: () => void = () => undefined;
    mocks.apply.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await open(); fireEvent.click(screen.getByRole('button', { name: '採用', exact: true }));
    expect(screen.getByRole('textbox', { name: '動画検索' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '次の動画', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'コメント' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '閉じる' })).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.getByRole('textbox', { name: '動画検索' })).toBeEnabled();
  });
  it('shows linked-scene 409 and keeps edits', async () => {
    mocks.apply.mockRejectedValue(conflict('ページに紐づいている場面は置き換えられません'));
    await open(); fireEvent.click(screen.getByRole('button', { name: '採用', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ページに紐づいている場面は置き換えられません');
    expect(screen.getByLabelText('場面1の名前')).toHaveValue('準備');
  });
  it('latches disabled for the dialog and sends no more GET or regenerate requests', async () => {
    mocks.get.mockRejectedValue(conflict('自動編集は無効です'));
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'AI案' })).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次の動画', exact: true }));
    await screen.findByRole('heading', { name: '次の動画' });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.regenerate).not.toHaveBeenCalled();
  });
  it.each([conflict('別の競合'), new Error('取得エラー')])('shows other GET failures', async (error) => {
    mocks.get.mockRejectedValue(error); render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('response' in error ? '別の競合' : '取得エラー');
    expect(screen.getByRole('complementary', { name: 'AI案' })).toBeInTheDocument();
  });
  it.each([
    ['PENDING', 'AI案を作成中'], ['RUNNING', 'AI案を作成中'], ['FAILED', 'AI案を作れませんでした'], ['SKIPPED', 'AI案を作れませんでした'], ['none', 'AI案はまだありません'], ['DISMISSED', '使わないにしました']
  ])('shows %s and allows regeneration when available', async (status, label) => {
    mocks.get.mockResolvedValue(status === 'none' ? null : status === 'DISMISSED' ? { ...row, decision: 'DISMISSED' } : { ...row, status, suggestion: null });
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />); await screen.findByText(label);
    if (status !== 'PENDING' && status !== 'RUNNING') {
      fireEvent.click(screen.getByRole('button', { name: status === 'none' ? 'AI案を作る' : '作り直す' }));
      await waitFor(() => expect(mocks.regenerate).toHaveBeenCalledExactlyOnceWith('v1'));
      expect(await screen.findByText('AI案を作成中')).toBeInTheDocument();
    }
  });
  it('shows regenerate conflicts', async () => {
    mocks.regenerate.mockRejectedValue(conflict('AI案を作成中です'));
    await open(); fireEvent.click(screen.getByRole('button', { name: /作り直す/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI案を作成中です');
  });
  it('shows applied captions read only and overlays them for four seconds', async () => {
    const comments = [{ atSeconds: 0, text: '採用した字幕' }, { atSeconds: 8, text: '次の字幕' }];
    mocks.comments.mockResolvedValue(comments); mocks.get.mockResolvedValue({ ...row, decision: 'APPLIED', confirmed: { scenes: row.suggestion!.scenes, comments } });
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} />);
    const player = await screen.findByLabelText('組立動画', { selector: 'video' }) as HTMLVideoElement;
    expect(await screen.findByText('字幕')).toBeInTheDocument(); expect(screen.queryByLabelText('場面1の字幕')).not.toBeInTheDocument();
    player.currentTime = 3.9; fireEvent.timeUpdate(player); expect(screen.getByTestId('video-caption')).toHaveTextContent('採用した字幕');
    player.currentTime = 4; fireEvent.timeUpdate(player); expect(screen.queryByTestId('video-caption')).not.toBeInTheDocument();
    player.currentTime = 8; fireEvent.timeUpdate(player); expect(screen.getByTestId('video-caption')).toHaveTextContent('次の字幕');
  });
  it('seeks and plays inline with keyboard and scene buttons, ignoring text inputs', async () => {
    await open(); const player = screen.getByLabelText('組立動画', { selector: 'video' }) as HTMLVideoElement;
    expect(player).not.toHaveAttribute('controls'); expect(player).toHaveAttribute('playsinline'); expect(player.muted).toBe(true);
    const stage = screen.getByRole('region', { name: '動画の編集台' });
    fireEvent.keyDown(stage, { key: 'ArrowRight' }); expect(player.currentTime).toBe(0.1);
    fireEvent.keyDown(stage, { key: 'ArrowRight', shiftKey: true }); expect(player.currentTime).toBe(1.1);
    fireEvent.keyDown(screen.getByLabelText('場面1の名前'), { key: 'ArrowRight', shiftKey: true }); expect(player.currentTime).toBe(1.1);
    fireEvent.keyDown(stage, { code: 'Space', key: ' ' }); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '場面2から再生' })); expect(player.currentTime).toBe(5);
    fireEvent.change(screen.getByRole('slider', { name: '再生位置' }), { target: { value: '2.3' } }); expect(player.currentTime).toBe(2.3);
    fireEvent.keyDown(stage, { key: 's' }); expect(screen.getByLabelText('場面3の名前')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: '場面1と2の境目' }), { key: 'ArrowRight' });
    expect(screen.getByRole('slider', { name: '場面1と2の境目' })).toHaveAttribute('aria-valuenow', '2.4'); expect(player.currentTime).toBe(2.4);
  });
  it('drags a boundary in tenths and clamps both neighbouring scenes', async () => {
    await open(); const player = screen.getByLabelText('組立動画', { selector: 'video' }) as HTMLVideoElement;
    const knob = screen.getByRole('slider', { name: '場面1と2の境目' });
    vi.spyOn(knob.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 120 } as DOMRect);
    vi.stubGlobal('PointerEvent', MouseEvent); knob.setPointerCapture = vi.fn();
    fireEvent.pointerDown(knob, { clientX: 50 });
    fireEvent.pointerMove(knob, { clientX: 43.6 });
    expect(knob).toHaveAttribute('aria-valuenow', '4.4'); expect(player.currentTime).toBe(4.4);
    fireEvent.pointerMove(knob, { clientX: 0 }); expect(knob).toHaveAttribute('aria-valuenow', '0.5');
    fireEvent.pointerMove(knob, { clientX: 120 }); expect(knob).toHaveAttribute('aria-valuenow', '11.5');
    fireEvent.pointerUp(knob);
    fireEvent.click(screen.getByRole('button', { name: '採用', exact: true }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith('v1', expect.objectContaining({
      scenes: [{ title: '準備', startSeconds: 0, endSeconds: 11.5 }, { title: '確認', startSeconds: 11.5, endSeconds: 12 }]
    })));
  });
  it('merges without confirmation and restores the previous scenes for four seconds', async () => {
    await open(); vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '場面1をとなりとまとめる' }));
    expect(screen.queryByLabelText('場面2の名前')).not.toBeInTheDocument(); expect(screen.getByLabelText('場面1の名前')).toHaveValue('確認');
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); expect(screen.getByLabelText('場面1の名前')).toHaveValue('準備');
    fireEvent.click(screen.getByRole('button', { name: '場面2をとなりとまとめる' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });
  it('undoes dismissal without sending, then sends once after four seconds', async () => {
    await open(); vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '使わない' })); expect(mocks.dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); expect(mocks.dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使わない' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); }); expect(mocks.dismiss).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith('v1', { suggestionId: 'suggestion-1' }); expect(screen.getByText('使わないにしました')).toBeInTheDocument();
  });
  it.each(['select', 'close', 'unmount'])('flushes a pending dismissal on %s', async (action) => {
    const view = await open(); fireEvent.click(screen.getByRole('button', { name: '使わない' }));
    if (action === 'unmount') view.unmount();
    else fireEvent.click(screen.getByRole('button', { name: action === 'select' ? '次の動画' : '閉じる', exact: true }));
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith('v1', { suggestionId: 'suggestion-1' }));
  });
  it('reports dismiss failure and retains the proposal', async () => {
    mocks.dismiss.mockRejectedValue(conflict('未決定の最新のAI案だけ却下できます'));
    await open(); fireEvent.click(screen.getByRole('button', { name: '使わない' })); fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未決定の最新のAI案だけ却下できます'); expect(screen.getByRole('button', { name: '採用', exact: true })).toBeInTheDocument();
  });
  it('polls AI work, refetches on status changes and stops when finished', async () => {
    mocks.list.mockResolvedValue([{ ...video, autoEdit: { status: 'RUNNING', decision: null } }]); mocks.get.mockResolvedValue({ ...row, status: 'RUNNING', suggestion: null });
    vi.useFakeTimers();
    await act(async () => { render(<ProcedureVideoShelfDialog onClose={vi.fn()} />); });
    expect(mocks.get).toHaveBeenCalledOnce();
    mocks.list.mockResolvedValue([video]); mocks.get.mockResolvedValue(row);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.get).toHaveBeenCalledTimes(2); expect(screen.getByLabelText('場面1の名前')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('keeps READY edits when another video is polled', async () => {
    mocks.list.mockResolvedValue([video, { ...second, autoEdit: { status: 'RUNNING', decision: null } }]);
    vi.useFakeTimers();
    await act(async () => { render(<ProcedureVideoShelfDialog onClose={vi.fn()} />); });
    fireEvent.change(screen.getByLabelText('場面1の名前'), { target: { value: '変更を保持' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.get).toHaveBeenCalledOnce(); expect(screen.getByLabelText('場面1の名前')).toHaveValue('変更を保持');
  });
  it('retains the linking list and never requests AI proposals', async () => {
    render(<ProcedureVideoShelfDialog onClose={vi.fn()} link={{ documentId: 'doc', pageIndex: 0, accessPassword: 'pw' }} />);
    const card = (await screen.findByText('組立動画')).closest('article')!;
    expect(within(card).getByRole('button', { name: '選ぶ' })).toBeInTheDocument(); expect(within(card).getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'AI案' })).not.toBeInTheDocument(); expect(mocks.get).not.toHaveBeenCalled();
  });
});
