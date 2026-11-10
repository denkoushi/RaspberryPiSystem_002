import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWatchCameraImage, listWatchCameraFrames } from '../../api/domains/watch-camera';
import { useAuth } from '../../contexts/AuthContext';

import { WatchCameraPage } from './WatchCameraPage';

vi.mock('../../api/domains/watch-camera', () => ({ listWatchCameraFrames: vi.fn(), getWatchCameraImage: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }));
const frame = { id: 'frame', deviceName: 'zero-edge-cam-1', capturedAt: '2026-10-29T15:01:02Z', judgement: 'person' as const };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><WatchCameraPage /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { role: 'ADMIN' } } as ReturnType<typeof useAuth>);
  vi.mocked(listWatchCameraFrames).mockResolvedValue([frame]);
  vi.mocked(getWatchCameraImage).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('watch camera admin page', () => {
  it.each(['MANAGER', 'VIEWER'])('does not request list or images for %s', (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>);
    mount();
    expect(listWatchCameraFrames).not.toHaveBeenCalled();
    expect(getWatchCameraImage).not.toHaveBeenCalled();
  });

  it('does not request data without a user', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
    mount();
    expect(listWatchCameraFrames).not.toHaveBeenCalled();
    expect(getWatchCameraImage).not.toHaveBeenCalled();
  });

  it('uses today in JST and renders thumbnails in API order with JST times', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:30:00Z'));
    vi.mocked(listWatchCameraFrames).mockResolvedValue([frame, { ...frame, id: 'older', capturedAt: '2026-10-29T15:00:00Z' }]);
    mount();
    expect(screen.getByLabelText('日付')).toHaveValue('2026-10-30');
    expect(listWatchCameraFrames).toHaveBeenCalledWith({ date: '2026-10-30' });
    await waitFor(() => expect(screen.getAllByAltText('監視カメラ')).toHaveLength(2));
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'zero-edge-cam-1 00:01:02を拡大', 'zero-edge-cam-1 00:00:00を拡大'
    ]);
    expect(screen.getByText('00:01:02')).toBeInTheDocument();
    expect(getWatchCameraImage).toHaveBeenCalledWith('frame', 'thumb');
    expect(getWatchCameraImage).not.toHaveBeenCalledWith('frame', 'full');
    expect(screen.queryByText('未判定')).not.toBeInTheDocument();
  });

  it('fetches again when the date changes and releases old thumbnails', async () => {
    const { unmount } = mount();
    await screen.findByAltText('監視カメラ');
    vi.mocked(listWatchCameraFrames).mockResolvedValue([{ ...frame, id: 'other-date', deviceName: 'zero-edge-cam-2' }]);
    fireEvent.change(screen.getByLabelText('日付'), { target: { value: '2026-10-28' } });
    await screen.findByText('zero-edge-cam-2');
    expect(listWatchCameraFrames).toHaveBeenLastCalledWith({ date: '2026-10-28' });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    await screen.findByAltText('監視カメラ');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('shows the unjudged marker only for unjudged frames', async () => {
    vi.mocked(listWatchCameraFrames).mockResolvedValue([frame, { ...frame, id: 'unjudged', judgement: 'unjudged' }]);
    mount();
    expect(await screen.findAllByText('未判定')).toHaveLength(1);
  });

  it('opens the full image and releases blob URLs on close and unmount', async () => {
    const { unmount } = mount();
    await screen.findByAltText('監視カメラ');
    fireEvent.click(screen.getByRole('button', { name: 'zero-edge-cam-1 00:01:02を拡大' }));
    expect(screen.getByRole('dialog', { name: '監視カメラ' })).toBeInTheDocument();
    expect(getWatchCameraImage).toHaveBeenCalledWith('frame', 'full');
    await waitFor(() => expect(screen.getAllByAltText('監視カメラ')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('leaves an empty grid without explanatory text for no frames', async () => {
    vi.mocked(listWatchCameraFrames).mockResolvedValue([]);
    mount();
    await waitFor(() => expect(listWatchCameraFrames).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
    expect(getWatchCameraImage).not.toHaveBeenCalled();
  });

  it('shows a list retrieval error', async () => {
    vi.mocked(listWatchCameraFrames).mockRejectedValue(new Error('unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('写真を取得できませんでした');
  });

  it('does not create blob URLs for images resolved after unmount', async () => {
    let resolveImage!: (blob: Blob) => void;
    vi.mocked(getWatchCameraImage).mockReturnValue(new Promise((resolve) => { resolveImage = resolve; }));
    const { unmount } = mount();
    await screen.findByText('zero-edge-cam-1');
    unmount();
    resolveImage(new Blob(['jpeg']));
    await waitFor(() => expect(getWatchCameraImage).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
