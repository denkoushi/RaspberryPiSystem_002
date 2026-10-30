import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../../../../api/client';
import { ShelfMasterPageContent } from '../../ShelfMasterPageContent';

import type { ShelfQueueRecord } from '../../offline/shelfOfflineQueueStore';

const offline = vi.hoisted(() => ({ records: [] as ShelfQueueRecord[], submit: vi.fn(), remove: vi.fn() }));
vi.mock('../../offline/useShelfOfflineQueue', () => ({ useShelfOfflineQueue: () => offline }));
vi.mock('../../../shelfPhoto/resizeShelfPhoto', () => ({ resizeShelfPhoto: vi.fn(async () => ({ contentType: 'image/jpeg', dataBase64: 'photo' })), rotateShelfPhoto: vi.fn(async () => ({ contentType: 'image/jpeg', dataBase64: 'rotated' })) }));

vi.mock('../../../../../api/client', () => ({
  getMobilePlacementShelfMachines: vi.fn(), getMobilePlacementRegisteredShelves: vi.fn(), getMobilePlacementShelfPhoto: vi.fn(),
  getMobilePlacementHaizenTargetDevices: vi.fn(), putMobilePlacementHaizenTargetPresetShelf: vi.fn(), deleteMobilePlacementShelf: vi.fn(),
  patchMobilePlacementShelfMemo: vi.fn(), putMobilePlacementShelfPhoto: vi.fn(), postMobilePlacementShelfLandmark: vi.fn(), deleteMobilePlacementShelfLandmark: vi.fn(),
}));
const routeState = { transferOrder: '1234567890', transferPart: 'PART', actualOrder: '1234567890', actualFseiban: 'S', actualPart: 'PART', slipResult: 'ok', shelfCode: '西-北-01', orderBarcode: '1234567890' };
function Hub() { const location = useLocation(); return <pre data-testid="hub">{JSON.stringify(location.state)}</pre>; }
function mount(width = 1920) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: width < 768, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: '/master', state: routeState }]}><Routes><Route path="/master" element={<ShelfMasterPageContent />} /><Route path="/kiosk/mobile-placement" element={<Hub />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); offline.records = []; offline.submit.mockResolvedValue('pending'); offline.remove.mockResolvedValue(undefined);
  vi.mocked(api.getMobilePlacementShelfMachines).mockResolvedValue({ machines: ['Ｍ１', 'M2'], landmarks: ['出荷口'] });
  vi.mocked(api.getMobilePlacementRegisteredShelves).mockResolvedValue({ shelves: [{ shelfCodeRaw: 'Ｍ１ 北', isStructured: true }, { shelfCodeRaw: 'legacy', isStructured: false }] });
  vi.mocked(api.getMobilePlacementHaizenTargetDevices).mockResolvedValue({ devices: [] });
  vi.mocked(api.deleteMobilePlacementShelf).mockResolvedValue({ success: true } as never);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('kiosk shelf master', () => {
  it('selects landmarks, shows occupied and empty directions, and groups legacy shelves', async () => {
    mount();
    expect(await screen.findByRole('button', { name: '棚 M1 北 を編集' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M1 南 に棚を追加' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /M2 加工機/ }));
    expect(screen.getByRole('button', { name: 'M2 北 に棚を追加' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '棚 M1 北 を編集' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /その他/ }));
    expect(screen.getByRole('button', { name: '棚 LEGACY を編集' })).toBeInTheDocument();
    for (const text of ['棚を移す', '配置を変える', '再割当', 'レイアウト']) expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
  });
  it('opens a new shelf with its automatic name and requires a photo', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'M1 南 に棚を追加' }));
    expect(screen.getByRole('textbox', { name: 'この棚の名前' })).toHaveValue('M1 南');
    expect(screen.getByRole('textbox', { name: 'この棚の名前' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
    expect(within(screen.getByRole('form', { name: '棚' })).getByRole('button', { name: '北', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(sessionStorage.getItem('mobile-placement:shelf-photo-draft')).toBeNull();
  });
  it('opens a saved shelf and confirms deletion with Escape and a four second timeout', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '棚 M1 北 を編集' }));
    expect(screen.getByRole('button', { name: '保存する' })).toBeEnabled();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    expect(screen.getByRole('button', { name: '本当に消す' })).toBeInTheDocument();
    expect(api.deleteMobilePlacementShelf).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    act(() => { vi.advanceTimersByTime(4000); });
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    expect(api.deleteMobilePlacementShelf).toHaveBeenCalledWith('Ｍ１ 北');
  });
  it('returns to the placement hub preserving route state', async () => {
    mount(); await screen.findByRole('button', { name: '棚 M1 北 を編集' });
    fireEvent.click(screen.getByRole('button', { name: '配膳へ戻る' }));
    expect(JSON.parse(screen.getByTestId('hub').textContent!)).toEqual(routeState);
  });
  it('registers a photo with the original machine value through the offline queue', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'M1 南 に棚を追加' }));
    fireEvent.change(screen.getByLabelText('棚の写真'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox', { name: 'メモ' }), { target: { value: '治具' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await waitFor(() => expect(offline.submit).toHaveBeenCalledWith({ shelfCodeRaw: 'Ｍ１ 南', displayLabel: '治具', photo: { contentType: 'image/jpeg', dataBase64: 'photo' } }));
    expect(await screen.findByRole('status')).toHaveTextContent('未送信に保存しました');
  });
  it('blocks pending shelves and opens the reason and removal for needs-check shelves', async () => {
    offline.records = [
      { id: 'pending', shelfCodeRaw: 'Ｍ１ 南', status: 'pending', stage: 'unregistered', displayLabel: null, photo: { contentType: 'image/jpeg', dataBase64: 'photo' }, createdAt: '' },
      { id: 'check', shelfCodeRaw: 'Ｍ１ 東', status: 'needs_check', stage: 'registered', message: '写真を送信できませんでした', displayLabel: null, photo: { contentType: 'image/jpeg', dataBase64: 'photo' }, createdAt: '' },
    ];
    mount();
    expect(await screen.findByRole('button', { name: '棚 M1 南 を編集' })).toBeDisabled();
    expect(screen.getByText('未送信 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '棚 M1 東 を編集' }));
    expect(screen.getByText('写真を送信できませんでした')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '消す', exact: true }));
    expect(offline.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '本当に消す' }));
    await waitFor(() => expect(offline.remove).toHaveBeenCalledWith('check'));
  });
  it('keeps occupied Zero2W devices disabled and saves an available assignment', async () => {
    vi.mocked(api.getMobilePlacementHaizenTargetDevices).mockResolvedValue({ devices: [
      { id: 'used', name: 'zero-used', shelfCodeRaw: 'M2 北', location: null, lastSeenAt: null },
      { id: 'free', name: 'zero-free', shelfCodeRaw: null, location: null, lastSeenAt: null },
    ] });
    mount(); fireEvent.click(await screen.findByRole('button', { name: '棚 M1 北 を編集' }));
    expect(await screen.findByRole('button', { name: 'zero-used' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'zero-free' }));
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(vi.mocked(api.putMobilePlacementHaizenTargetPresetShelf).mock.calls[0]?.[0]).toEqual({ clientDeviceId: 'free', shelfCodeRaw: 'Ｍ１ 北' }));
  });
  it('only deletes empty added landmarks after two presses', async () => {
    mount();
    const remove = await screen.findByRole('button', { name: '出荷口 を消す' });
    fireEvent.click(remove);
    expect(api.deleteMobilePlacementShelfLandmark).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await waitFor(() => expect(api.deleteMobilePlacementShelfLandmark).toHaveBeenCalledWith('出荷口'));
    expect(screen.queryByRole('button', { name: 'M1 を消す' })).not.toBeInTheDocument();
  });
  it('uses the phone page on a narrow screen', async () => {
    mount(390);
    expect(await screen.findByRole('button', { name: '棚を追加' })).toBeInTheDocument();
    expect(screen.queryByTestId('shelf-master-kiosk')).not.toBeInTheDocument();
  });
});
