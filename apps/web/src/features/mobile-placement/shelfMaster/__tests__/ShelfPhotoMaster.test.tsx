import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../api/client';
import { api as http } from '../../../../api/http';
import { resetMobileConnectivityForTests } from '../../connectivity';
import { encodeShelfPhoto, resizeShelfPhoto, rotateShelfPhoto } from '../../shelfPhoto/resizeShelfPhoto';
import { ShelfPhotoMaster } from '../components/ShelfPhotoMaster';
import { shelfOfflineQueueStore } from '../offline/shelfOfflineQueueStore';
import { readShelfPhotoDraft } from '../shelfPhotoDraft';

vi.mock('../../../../api/http', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../../../api/client', () => ({
  getMobilePlacementShelfMachines: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
  postMobilePlacementShelfLandmark: vi.fn(), deleteMobilePlacementShelfLandmark: vi.fn(),
  putMobilePlacementShelfPhoto: vi.fn(), patchMobilePlacementShelfMemo: vi.fn(), deleteMobilePlacementShelf: vi.fn()
}));
vi.mock('../../shelfPhoto/resizeShelfPhoto', () => ({ resizeShelfPhoto: vi.fn(), encodeShelfPhoto: vi.fn(), rotateShelfPhoto: vi.fn() }));
const shelves = [
  { shelfCodeRaw: '西-北-01', isStructured: true, displayLabel: '南 上段', photoUpdatedAt: null },
  { shelfCodeRaw: 'DAD-3220 西', isStructured: true, machineName: 'DAD-3220', direction: '西' as const, displayLabel: null, photoUpdatedAt: null }
];
const photo = { contentType: 'image/jpeg' as const, dataBase64: '/9j/' };
function mount(onMessage?: (message: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><ShelfPhotoMaster onMessage={onMessage} /></QueryClientProvider>);
  return invalidate;
}
async function openAdd() {
  await waitFor(() => expect(screen.getByRole('button', { name: '棚を追加' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
  await selectLandmark('DAD-3220');
  fireEvent.click(within(screen.getByRole('group', { name: '方角' })).getByRole('button', { name: '北' }));
}
async function selectLandmark(name: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name, exact: true }));
}
async function takePhoto() {
  fireEvent.change(screen.getByLabelText('棚の写真'), { target: { files: [new File(['image'], 'shelf.jpg', { type: 'image/jpeg' })] } });
  await screen.findByAltText('登録する棚の写真');
}
beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  for (const record of await shelfOfflineQueueStore.list()) await shelfOfflineQueueStore.remove(record.id);
  vi.resetAllMocks();
  window.dispatchEvent(new Event('online'));
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves });
  vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['50013_540AP', 'DAD-3220'], landmarks: ['電気室', 'テント倉庫'] });
  vi.mocked(resizeShelfPhoto).mockResolvedValue(photo);
  vi.mocked(encodeShelfPhoto).mockReturnValue(photo);
  vi.mocked(http.post).mockResolvedValue({ shelf: { shelfCodeRaw: 'DAD-3220 北', isStructured: true } });
  vi.mocked(api.putMobilePlacementShelfPhoto).mockResolvedValue({ photoUpdatedAt: '2026-10-22T10:00:00Z' });
  vi.mocked(http.put).mockResolvedValue({ photoUpdatedAt: '2026-10-22T10:00:00Z' });
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('photo shelf master', () => {
  it('saves both lists before opening the add form', async () => {
    mount();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mobile-placement-shelf-machines-v1')!)).toEqual({
      machines: ['50013_540AP', 'DAD-3220'], landmarks: ['電気室', 'テント倉庫']
    }));
    expect(JSON.parse(localStorage.getItem('mobile-placement-registered-shelves-v1')!)).toEqual({ shelves });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects a stored landmark while online requests are pending and after they fail', async () => {
    localStorage.setItem('mobile-placement-registered-shelves-v1', JSON.stringify({ shelves }));
    localStorage.setItem('mobile-placement-shelf-machines-v1', JSON.stringify({ machines: ['DAD-3220'], landmarks: [] }));
    let failMachines!: (error: Error) => void;
    let failShelves!: (error: Error) => void;
    vi.mocked(api.getMobilePlacementShelfMachines).mockReturnValue(new Promise((_, reject) => { failMachines = reject; }));
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockReturnValue(new Promise((_, reject) => { failShelves = reject; }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
    expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled();
    await selectLandmark('DAD-3220');
    await act(async () => { failMachines(new Error('offline')); failShelves(new Error('offline')); });
    expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled();
    expect(screen.getByRole('button', { name: '目安', exact: true })).toHaveTextContent('DAD-3220');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the existing error and retry immediately when no landmark is stored offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: '棚を追加' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
    const form = within(screen.getByRole('dialog', { name: '棚を追加' }));
    expect(form.getByRole('alert')).toHaveTextContent('目安を取得できませんでした');
    expect(form.getByRole('button', { name: '再試行' })).toBeEnabled();
    expect(api.getMobilePlacementShelfMachines).not.toHaveBeenCalled();
    expect(api.getMobilePlacementRegisteredShelves).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fireEvent.click(form.getByRole('button', { name: '再試行' }));
    await selectLandmark('電気室');
  });

  it('deletes on the second tap, disables controls while busy, refreshes queries and closes', async () => {
    let resolveDelete!: (value: { shelfCodeRaw: string }) => void;
    vi.mocked(api.deleteMobilePlacementShelf).mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    const onMessage = vi.fn();
    const invalidate = mount(onMessage);
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: 'この棚を消す' }));
    expect(api.deleteMobilePlacementShelf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    expect(api.deleteMobilePlacementShelf).toHaveBeenCalledExactlyOnceWith('西-北-01');
    expect(screen.getByRole('button', { name: '本当に消す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled();
    resolveDelete({ shelfCodeRaw: '西-北-01' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'registered-shelves'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'shelf-layout'] });
    expect(onMessage).toHaveBeenCalledWith('西-北-01 を消しました');
  });

  it('cancels delete confirmation without calling the API', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: 'この棚を消す' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getByRole('button', { name: 'この棚を消す' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '本当に消す' })).not.toBeInTheDocument();
    expect(api.deleteMobilePlacementShelf).not.toHaveBeenCalled();
  });

  it('shows the 409 server message and resets confirmation', async () => {
    const message = '品物が 3件 置いてあるので消せません。先に「棚を動かす」で移してください';
    vi.mocked(api.deleteMobilePlacementShelf).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message } } });
    const onMessage = vi.fn();
    const invalidate = mount(onMessage);
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: 'この棚を消す' }));
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'この棚を消す' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '本当に消す' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('does not offer deletion when adding a shelf', async () => {
    mount(); await openAdd();
    expect(screen.queryByRole('button', { name: 'この棚を消す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '本当に消す' })).not.toBeInTheDocument();
  });

  it('clears direction when changing machine and disables every registered direction', async () => {
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [
      ...shelves, ...(['北西', '北', '北東', '西', '東', '南西', '南', '南東'] as const).map((direction) => ({
        shelfCodeRaw: `50013_540AP ${direction}`, machineName: '50013_540AP', direction, isStructured: true
      }))
    ] });
    mount(); await openAdd();
    await selectLandmark('50013_540AP');
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('');
    for (const direction of ['北西', '北', '北東', '西', '東', '南西', '南', '南東']) {
      expect(screen.getByRole('button', { name: `${direction} 登録済み` })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  });

  it('requires machine/direction/photo, previews the code and saves memo then photo', async () => {
    const invalidate = mount();
    await openAdd();
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('DAD-3220 北');
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '西 登録済み' })).toBeDisabled();
    expect(screen.getByLabelText('この棚の名前')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '  ロボドリル01 南 上段  ' } });
    await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await waitFor(() => expect(http.put).toHaveBeenCalledWith(`/mobile-placement/shelves/${encodeURIComponent('DAD-3220 北')}/photo`, photo, { timeout: 60_000 }));
    expect(http.post).toHaveBeenCalledWith('/mobile-placement/shelves', { shelfCodeRaw: 'DAD-3220 北', displayLabel: 'ロボドリル01 南 上段' }, { timeout: 60_000 });
    expect(vi.mocked(http.post).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(http.put).mock.invocationCallOrder[0]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'registered-shelves'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(readShelfPhotoDraft()).toBeNull();
    cleanup(); mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('changes memo independently and keeps existing IDs read-only', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    expect(screen.getByLabelText('この棚の名前')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.patchMobilePlacementShelfMemo).toHaveBeenCalledWith('西-北-01', null));
    expect(api.putMobilePlacementShelfPhoto).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it('turns the new photo a quarter turn on each tap and saves the turned photo', async () => {
    const turned = { contentType: 'image/jpeg' as const, dataBase64: 'TURNED' };
    vi.mocked(rotateShelfPhoto).mockResolvedValue(turned);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    expect(screen.queryByRole('button', { name: '写真を回す' })).not.toBeInTheDocument();
    await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '写真を回す' }));
    await waitFor(() => expect(screen.getByAltText('登録する棚の写真')).toHaveAttribute('src', 'data:image/jpeg;base64,TURNED'));
    expect(rotateShelfPhoto).toHaveBeenCalledWith(photo);
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.putMobilePlacementShelfPhoto).toHaveBeenCalledWith('西-北-01', turned));
  });

  it('updates an existing photo without requiring machine or direction', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.putMobilePlacementShelfPhoto).toHaveBeenCalledWith('西-北-01', photo));
    expect(http.post).not.toHaveBeenCalled();
    expect(api.patchMobilePlacementShelfMemo).not.toHaveBeenCalled();
  });
  it('shows duplicate errors as needs-check and deletes the local record only on the second tap', async () => {
    vi.mocked(http.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { message: 'この加工機・方角の棚はもうあります' } } });
    mount(); await openAdd(); await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    fireEvent.click(await screen.findByRole('button', { name: '棚 DAD-3220 北 要確認' }));
    expect(screen.getByRole('dialog', { name: '要確認' })).toHaveTextContent('この加工機・方角の棚はもうあります');
    expect(http.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    expect(await shelfOfflineQueueStore.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await shelfOfflineQueueStore.list()).toEqual([]);
    expect(api.deleteMobilePlacementShelf).not.toHaveBeenCalled();
  });
  it('queues a failed photo upload and accepts the registered shelf conflict on replay', async () => {
    vi.mocked(http.put).mockRejectedValueOnce(new Error('写真を保存できません'));
    const onMessage = vi.fn();
    mount(onMessage); await openAdd(); await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await screen.findByRole('button', { name: '棚 DAD-3220 北 未送信' });
    expect(onMessage).toHaveBeenCalledWith('未送信に保存しました');
    expect((await shelfOfflineQueueStore.list())[0].stage).toBe('registered');
    vi.mocked(http.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(http.put).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('未送信')).not.toBeInTheDocument());
    expect(await shelfOfflineQueueStore.list()).toEqual([]);
  });
});

describe('landmark sheet and compass', () => {
  it('renders the compass in north-up 3 by 3 order and registers a directionless landmark', async () => {
    mount(); await openAdd();
    const compass = screen.getByRole('group', { name: '方角' });
    expect(compass).toHaveClass('grid-cols-3');
    expect(within(compass).getAllByRole('button').map((button) => button.textContent)).toEqual(['北西', '北', '北東', '西登録済み', '方角なし', '東', '南西', '南', '南東']);
    await selectLandmark('電気室');
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '方角なし' }));
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('電気室');
    await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/mobile-placement/shelves', { shelfCodeRaw: '電気室', displayLabel: null }, { timeout: 60_000 }));
  });

  it('disables an already registered directionless shelf', async () => {
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [...shelves, { shelfCodeRaw: '電気室', machineName: '電気室', isStructured: true }] });
    mount(); await openAdd(); await selectLandmark('電気室');
    expect(screen.getByRole('button', { name: '方角なし 登録済み' })).toBeDisabled();
  });

  it('adds a landmark, selects it and invalidates both queries', async () => {
    vi.mocked(api.postMobilePlacementShelfLandmark).mockResolvedValue({ name: '第二倉庫' });
    const invalidate = mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
    expect(screen.getByRole('button', { name: 'DAD-3220', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('例: 電気室')).toHaveAttribute('maxlength', '30');
    fireEvent.change(screen.getByPlaceholderText('例: 電気室'), { target: { value: ' 第二倉庫 ' } });
    fireEvent.click(screen.getByRole('button', { name: '追加', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '目安を選ぶ' })).not.toBeInTheDocument());
    expect(api.postMobilePlacementShelfLandmark).toHaveBeenCalledWith('第二倉庫');
    expect(screen.getByRole('button', { name: '目安', exact: true })).toHaveTextContent('第二倉庫');
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'shelf-machines'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'registered-shelves'] });
  });

  it('deletes only unused landmarks on the second tap and clears the selected name', async () => {
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [...shelves, { shelfCodeRaw: '電気室 南東', machineName: '電気室', direction: '南東', isStructured: true }] });
    vi.mocked(api.deleteMobilePlacementShelfLandmark).mockResolvedValue({ name: 'テント倉庫' });
    const invalidate = mount(); await openAdd(); await selectLandmark('テント倉庫');
    fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
    expect(screen.queryByRole('button', { name: '電気室 を消す' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DAD-3220 を消す' })).not.toBeInTheDocument();
    const remove = screen.getByRole('button', { name: 'テント倉庫 を消す' });
    expect(remove).toHaveTextContent('×'); fireEvent.click(remove);
    expect(api.deleteMobilePlacementShelfLandmark).not.toHaveBeenCalled();
    expect(remove).toHaveTextContent('消す'); fireEvent.click(remove);
    await waitFor(() => expect(api.deleteMobilePlacementShelfLandmark).toHaveBeenCalledWith('テント倉庫'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'shelf-machines'] }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: '目安', exact: true })).toHaveTextContent('目安を選ぶ');
  });

  it.each(['加工機と同じ名前は使えません', 'この目安はもうあります'])('shows the server error %s near the add input', async (message) => {
    vi.mocked(api.postMobilePlacementShelfLandmark).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message } } });
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
    fireEvent.change(screen.getByPlaceholderText('例: 電気室'), { target: { value: '電気室' } });
    fireEvent.click(screen.getByRole('button', { name: '追加', exact: true }));
    expect(await within(screen.getByRole('dialog', { name: '目安を選ぶ' })).findByRole('alert')).toHaveTextContent(message);
  });

  it('closes only the sheet on backdrop or Escape', async () => {
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
    fireEvent.mouseDown(screen.getByRole('dialog', { name: '目安を選ぶ' }));
    expect(screen.queryByRole('dialog', { name: '目安を選ぶ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '目安', exact: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '目安を選ぶ' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '棚を追加' })).toBeInTheDocument();
  });

  it('retries an HTTP 503 landmark list failure', async () => {
    vi.mocked(api.getMobilePlacementShelfMachines).mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } });
    mount(); await screen.findByRole('button', { name: '棚を追加' });
    await waitFor(() => expect(screen.getByRole('button', { name: '棚を追加' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '目安', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled());
  });
});


describe('shelf photo draft and camera entry', () => {
  it.each(['北', '方角なし'])('restores landmark, %s and memo on remount, without the photo', async (direction) => {
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: direction, exact: true }));
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '上段' } });
    await takePhoto();
    expect(readShelfPhotoDraft()).toEqual({ machine: 'DAD-3220', direction: direction === '北' ? '北' : '', memo: '上段' });
    cleanup(); mount();
    expect(screen.getByRole('dialog', { name: '棚を追加' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '目安', exact: true })).toHaveTextContent('DAD-3220');
    expect(screen.getByRole('button', { name: direction, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('メモ')).toHaveValue('上段');
    expect(screen.queryByAltText('登録する棚の写真')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  });

  it('clears the draft when the form is closed', async () => {
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(readShelfPhotoDraft()).toBeNull();
    cleanup(); mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves the photo and clears the draft on a no-response registration failure', async () => {
    vi.mocked(http.post).mockRejectedValueOnce(new Error('offline'));
    mount(); await openAdd(); await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await screen.findByRole('button', { name: '棚 DAD-3220 北 未送信' });
    expect(readShelfPhotoDraft()).toBeNull();
    expect(await shelfOfflineQueueStore.list()).toEqual([expect.objectContaining({ stage: 'unregistered', photo })]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts a camera capture into the form and can capture the next shelf', async () => {
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    mount();
    for (let i = 1; i <= 2; i++) {
      await openAdd();
      fireEvent.click(screen.getByRole('button', { name: '棚の写真を撮る' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '撮る' })).toBeEnabled());
      expect(screen.queryByRole('button', { name: '写真を選ぶ' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '撮る' }));
      expect(screen.getByAltText('登録する棚の写真')).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/');
      expect(stop).toHaveBeenCalledTimes(i);
      expect(screen.queryByRole('dialog', { name: '写真を撮る' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '登録する' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(resizeShelfPhoto).not.toHaveBeenCalled();
    expect(http.put).toHaveBeenCalledTimes(2);
  });

  it('opens the camera first and falls back to the file input on failure', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
    mount(); await openAdd();
    const input = screen.getByLabelText('棚の写真');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: '棚の写真を撮る' }));
    expect(click).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('カメラを使えません');
    fireEvent.click(screen.getByRole('button', { name: '写真を選ぶ' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '写真を撮る' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '棚を追加' })).toBeInTheDocument();
    await takePhoto();
  });

  it('closes only the camera on Escape and keeps the draft', async () => {
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '棚の写真を撮る' }));
    await screen.findByRole('alert');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '写真を撮る' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '棚を追加' })).toBeInTheDocument();
    expect(readShelfPhotoDraft()?.machine).toBe('DAD-3220');
  });

  it('works when storage reads and writes throw', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    mount(); await openAdd();
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '上段' } });
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});


describe('offline shelf registration', () => {
  it('opens cached lists offline, queues a shelf with its local photo, blocks duplicate directions and sends on reconnect', async () => {
    mount(); await openAdd();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    cleanup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockRejectedValue(new Error('offline'));
    vi.mocked(api.getMobilePlacementShelfMachines).mockRejectedValue(new Error('offline'));
    const onMessage = vi.fn();
    mount(onMessage);
    expect(await screen.findByRole('button', { name: '棚 西-北-01 を編集' })).toBeInTheDocument();
    await openAdd(); await takePhoto();
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '上段' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    const pending = await screen.findByRole('button', { name: '棚 DAD-3220 北 未送信' });
    expect(within(pending).getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/');
    expect(pending).toHaveTextContent('上段');
    expect(onMessage).toHaveBeenCalledWith('未送信に保存しました');
    expect(http.post).not.toHaveBeenCalled();
    expect((await shelfOfflineQueueStore.list())[0]).toMatchObject({ stage: 'unregistered', status: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
    await selectLandmark('DAD-3220');
    expect(screen.getByRole('button', { name: '北 登録済み' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [...shelves, { shelfCodeRaw: 'DAD-3220 北', isStructured: true }] });
    vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['DAD-3220'], landmarks: [] });
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText('未送信')).not.toBeInTheDocument());
    expect(http.put).toHaveBeenCalledWith(`/mobile-placement/shelves/${encodeURIComponent('DAD-3220 北')}/photo`, photo, { timeout: 60_000 });
    expect(await shelfOfflineQueueStore.list()).toEqual([]);
    expect(await screen.findByRole('button', { name: '棚 DAD-3220 北 を編集' })).toBeInTheDocument();
  });

  it('shows a queued registered shelf only once when it is also in the server list', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await shelfOfflineQueueStore.put({ id: 'queued', shelfCodeRaw: '西-北-01', displayLabel: null, photo,
      stage: 'registered', status: 'needs_check', message: '写真を確認してください', createdAt: '2026-10-27T00:00:00Z' });
    mount();
    await screen.findByRole('button', { name: '棚 西-北-01 要確認' });
    expect(screen.queryByRole('button', { name: '棚 西-北-01 を編集' })).not.toBeInTheDocument();
    expect(screen.getAllByText('西-北-01')).toHaveLength(1);
  });
});
