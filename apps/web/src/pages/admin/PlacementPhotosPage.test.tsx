import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlacementPhoto, listPlacementPhotos } from '../../api/domains/placement-photos';
import { useAuth } from '../../contexts/AuthContext';

import { PlacementPhotosPage } from './PlacementPhotosPage';

vi.mock('../../api/domains/placement-photos', () => ({ listPlacementPhotos: vi.fn(), getPlacementPhoto: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
const photo = { id: 'frame', number: '001', slipKind: 'manufacturing_order' as const, branchNo: 2, shelfCodeRaw: '北-1', deviceName: 'スマホ', placedAt: '2026-10-29T03:00:00Z', hasCrop: true };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlacementPhotosPage /></MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { role: 'ADMIN' } } as ReturnType<typeof useAuth>);
  vi.mocked(listPlacementPhotos).mockResolvedValue([photo]);
  vi.mocked(getPlacementPhoto).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('placement photos admin page', () => {
  it.each(['MANAGER', 'VIEWER'])('does not request list or images for %s', (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>);
    mount(); expect(listPlacementPhotos).not.toHaveBeenCalled(); expect(getPlacementPhoto).not.toHaveBeenCalled();
  });
  it('renders two authenticated thumbnails and enlarged images and revokes blob URLs', async () => {
    const { unmount } = mount();
    expect(await screen.findByText('001')).toBeInTheDocument();
    expect(await screen.findByAltText('切り抜き')).toHaveAttribute('src', 'blob:test');
    expect(getPlacementPhoto).toHaveBeenCalledWith('frame', 'crop-thumb');
    expect(getPlacementPhoto).toHaveBeenCalledWith('frame', 'full-thumb');
    expect(getPlacementPhoto).not.toHaveBeenCalledWith('frame', 'full');
    expect(getPlacementPhoto).not.toHaveBeenCalledWith('frame', 'crop');
    fireEvent.click(screen.getByRole('button', { name: '001 全体を拡大' }));
    expect(getPlacementPhoto).toHaveBeenCalledWith('frame', 'full');
    expect(getPlacementPhoto).toHaveBeenCalledWith('frame', 'crop');
    expect(screen.getByRole('dialog', { name: '配膳写真' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /001 → 北-1/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByAltText('全体')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });
  it('passes number, shelf and date filters', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('製造order / 注番'), { target: { value: '001' } });
    fireEvent.change(screen.getByLabelText('棚'), { target: { value: '北-1' } });
    fireEvent.change(screen.getByLabelText('日付'), { target: { value: '2026-10-29' } });
    await waitFor(() => expect(listPlacementPhotos).toHaveBeenLastCalledWith({ q: '001', shelf: '北-1', date: '2026-10-29' }));
  });
  it('debounces filter changes for 300ms', async () => {
    vi.useFakeTimers();
    mount();
    fireEvent.change(screen.getByLabelText('製造order / 注番'), { target: { value: '0' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.change(screen.getByLabelText('製造order / 注番'), { target: { value: '001' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(listPlacementPhotos).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(listPlacementPhotos).toHaveBeenCalledTimes(2);
    expect(listPlacementPhotos).toHaveBeenLastCalledWith({ q: '001', shelf: '', date: '' });
  });
  it('does not expose null in image button labels', async () => {
    vi.mocked(listPlacementPhotos).mockResolvedValue([{ ...photo, number: null }]);
    mount();
    expect(await screen.findByRole('button', { name: '— 全体を拡大' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /null/ })).not.toBeInTheDocument();
  });
  it('uses a dash for an absent crop', async () => {
    vi.mocked(listPlacementPhotos).mockResolvedValue([{ ...photo, hasCrop: false }]);
    mount(); await screen.findByText('001');
    expect(screen.queryByRole('button', { name: '001 切り抜きを拡大' })).not.toBeInTheDocument();
    expect(getPlacementPhoto).not.toHaveBeenCalledWith('frame', 'crop-thumb');
  });
});
