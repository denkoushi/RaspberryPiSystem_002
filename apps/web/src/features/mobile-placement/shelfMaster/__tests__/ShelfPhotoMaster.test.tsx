import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../api/client';
import { resizeShelfPhoto } from '../../shelfPhoto/resizeShelfPhoto';
import { ShelfPhotoMaster } from '../components/ShelfPhotoMaster';

vi.mock('../../../../api/client', () => ({
  getMobilePlacementShelfMachines: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
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
  await screen.findByRole('option', { name: 'DAD-3220' });
  fireEvent.change(screen.getByLabelText('加工機'), { target: { value: 'DAD-3220' } });
  fireEvent.click(within(screen.getByRole('group', { name: '方角' })).getByRole('button', { name: '北' }));
}
async function takePhoto() {
  fireEvent.change(screen.getByLabelText('棚の写真'), { target: { files: [new File(['image'], 'shelf.jpg', { type: 'image/jpeg' })] } });
  await screen.findByAltText('登録する棚の写真');
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves });
  vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['50013_540AP', 'DAD-3220'] });
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
      ...shelves, ...(['東', '西', '南', '北'] as const).map((direction) => ({
        shelfCodeRaw: `50013_540AP ${direction}`, machineName: '50013_540AP', direction, isStructured: true
      }))
    ] });
    mount(); await openAdd();
    fireEvent.change(screen.getByLabelText('加工機'), { target: { value: '50013_540AP' } });
    expect(screen.getByLabelText('この棚の名前')).toHaveValue('');
    for (const direction of ['東', '西', '南', '北']) {
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
    expect(screen.getByLabelText('加工機')).toBeEnabled();
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
