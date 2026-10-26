import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../api/client';
import { resizeShelfPhoto } from '../../shelfPhoto/resizeShelfPhoto';
import { ShelfPhotoMaster } from '../components/ShelfPhotoMaster';

vi.mock('../../../../api/client', () => ({
  getMobilePlacementShelfMachines: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
  postMobilePlacementShelfLandmark: vi.fn(), deleteMobilePlacementShelfLandmark: vi.fn(),
  postMobilePlacementShelfRegister: vi.fn(), putMobilePlacementShelfPhoto: vi.fn(), patchMobilePlacementShelfMemo: vi.fn(), deleteMobilePlacementShelf: vi.fn()
}));
vi.mock('../../shelfPhoto/resizeShelfPhoto', () => ({ resizeShelfPhoto: vi.fn() }));
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves });
  vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['50013_540AP', 'DAD-3220'], landmarks: ['電気室', 'テント倉庫'] });
  vi.mocked(resizeShelfPhoto).mockResolvedValue(photo);
  vi.mocked(api.postMobilePlacementShelfRegister).mockResolvedValue({ shelf: { shelfCodeRaw: 'DAD-3220 北', isStructured: true } });
  vi.mocked(api.putMobilePlacementShelfPhoto).mockResolvedValue({ photoUpdatedAt: '2026-10-22T10:00:00Z' });
});
describe('photo shelf master', () => {
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
    await waitFor(() => expect(api.putMobilePlacementShelfPhoto).toHaveBeenCalledWith('DAD-3220 北', photo));
    expect(api.postMobilePlacementShelfRegister).toHaveBeenCalledWith({ shelfCodeRaw: 'DAD-3220 北', displayLabel: 'ロボドリル01 南 上段' });
    expect(vi.mocked(api.postMobilePlacementShelfRegister).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.putMobilePlacementShelfPhoto).mock.invocationCallOrder[0]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'registered-shelves'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('changes memo independently and keeps existing IDs read-only', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    expect(screen.getByLabelText('この棚の名前')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.patchMobilePlacementShelfMemo).toHaveBeenCalledWith('西-北-01', null));
    expect(api.putMobilePlacementShelfPhoto).not.toHaveBeenCalled();
    expect(api.postMobilePlacementShelfRegister).not.toHaveBeenCalled();
  });
  it('updates an existing photo without requiring machine or direction', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 西-北-01 を編集' }));
    await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(api.putMobilePlacementShelfPhoto).toHaveBeenCalledWith('西-北-01', photo));
    expect(api.postMobilePlacementShelfRegister).not.toHaveBeenCalled();
    expect(api.patchMobilePlacementShelfMemo).not.toHaveBeenCalled();
  });
  it('shows duplicate/server errors inline', async () => {
    vi.mocked(api.postMobilePlacementShelfRegister).mockRejectedValueOnce(new Error('この加工機・方角の棚はもうあります'));
    mount(); await openAdd(); await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('この加工機・方角の棚はもうあります');
    expect(api.putMobilePlacementShelfPhoto).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled();
  });
  it('retries a failed photo upload without creating the shelf twice', async () => {
    vi.mocked(api.putMobilePlacementShelfPhoto).mockRejectedValueOnce(new Error('写真を保存できません'));
    mount(); await openAdd(); await takePhoto();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('この棚の名前')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await waitFor(() => expect(api.putMobilePlacementShelfPhoto).toHaveBeenCalledTimes(2));
    expect(api.postMobilePlacementShelfRegister).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(api.postMobilePlacementShelfRegister).toHaveBeenCalledWith({ shelfCodeRaw: '電気室', displayLabel: null }));
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

  it('retries a failed landmark list', async () => {
    vi.mocked(api.getMobilePlacementShelfMachines).mockRejectedValueOnce(new Error('offline'));
    mount(); await screen.findByRole('button', { name: '棚を追加' });
    await waitFor(() => expect(screen.getByRole('button', { name: '棚を追加' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '棚を追加' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '目安', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '目安', exact: true })).toBeEnabled());
  });
});
