import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../api/domains/watch-camera';

import { WatchCameraSampleTab } from './WatchCameraSampleTab';

vi.mock('../../api/domains/watch-camera', () => ({ listSampleCameras: vi.fn(), listSampleSessions: vi.fn(), listSampleFrames: vi.fn(),
  startSampleSession: vi.fn(), stopSampleSession: vi.fn(), labelSampleFrame: vi.fn(), deleteSampleSession: vi.fn(), getSampleImage: vi.fn() }));
const session: api.SampleSession = { id: 'session', deviceName: 'zero-edge-cam-1', intervalSec: 10, durationSec: 300,
  maxFrames: 2000, status: 'stopped', startedAt: '2026-10-31T00:00:00Z', endsAt: '2026-10-31T00:05:00Z',
  endedAt: '2026-10-31T00:01:00Z', frameCount: 1, byteSize: 35000, counts: { ok: 0, ng: 0, later: 0, none: 1 } };
const frame: api.SampleFrame = { id: 'frame', capturedAt: '2026-10-31T00:00:00Z', label: null };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WatchCameraSampleTab /></QueryClientProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listSampleCameras).mockResolvedValue([{ id: 'camera', name: 'zero-edge-cam-1', location: null }, { id: 'camera-2', name: 'zero-edge-cam-2', location: null }]);
  vi.mocked(api.listSampleSessions).mockResolvedValue([]);
  vi.mocked(api.listSampleFrames).mockResolvedValue([frame]);
  vi.mocked(api.getSampleImage).mockResolvedValue(new Blob(['jpeg']));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:sample'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('watch camera sample tab', () => {
  it('starts with selected camera, interval, duration, and integer frame cap', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: '撮影を始める' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('カメラ'), { target: { value: 'camera-2' } });
    fireEvent.click(within(screen.getByRole('group', { name: '間隔' })).getByRole('button', { name: '30秒' }));
    fireEvent.click(within(screen.getByRole('group', { name: '期間' })).getByRole('button', { name: '1時間' }));
    fireEvent.change(screen.getByLabelText('上限枚数'), { target: { value: '100' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '撮影を始める' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '撮影を始める' }));
    await waitFor(() => expect(api.startSampleSession).toHaveBeenCalledWith({ clientDeviceId: 'camera-2', intervalSec: 30, durationSec: 3600, maxFrames: 100 }));
  });
  it('shows the estimate and warns when the frame cap shortens the duration', async () => {
    mount(); await screen.findByRole('option', { name: 'zero-edge-cam-1' });
    expect(screen.getByText('30', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('1.1', { selector: 'b' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: '期間' })).getByRole('button', { name: '1週間' }));
    expect(screen.getByText('2,000', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('70', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('上限枚数で止まるため、期間の途中で終わります。')).toBeInTheDocument();
    expect(screen.getByText(/5.6時間で終わります/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('上限枚数'), { target: { value: '9' } });
    expect(screen.getByRole('button', { name: '撮影を始める' })).toBeDisabled();
  });
  it('updates labels and resets them on a second click', async () => {
    vi.mocked(api.listSampleSessions).mockResolvedValue([session]);
    mount(); await screen.findByAltText('見本');
    const normal = screen.getAllByRole('button', { name: '正常' }).at(-1)!;
    expect(normal).toHaveAttribute('aria-pressed', 'false');
    vi.mocked(api.listSampleFrames).mockResolvedValue([{ ...frame, label: 'ok' }]);
    fireEvent.click(normal);
    await waitFor(() => expect(api.labelSampleFrame).toHaveBeenCalledWith('frame', 'ok'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '正常' }).at(-1)).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getAllByRole('button', { name: '正常' }).at(-1)!);
    await waitFor(() => expect(api.labelSampleFrame).toHaveBeenLastCalledWith('frame', null));
  });
  it('filters on the server and shows counts from the whole session', async () => {
    vi.mocked(api.listSampleSessions).mockResolvedValue([session]);
    mount(); await screen.findByAltText('見本');
    expect(screen.getByText('未選択 1')).toBeInTheDocument();
    vi.mocked(api.listSampleFrames).mockResolvedValue([]);
    fireEvent.click(within(screen.getByRole('group', { name: '絞り込み' })).getByRole('button', { name: '異常' }));
    await waitFor(() => expect(api.listSampleFrames).toHaveBeenLastCalledWith('session', 'ng'));
    expect(await screen.findByText('この条件の写真はありません')).toBeInTheDocument();
  });
  it('deletes only after two presses', async () => {
    vi.mocked(api.listSampleSessions).mockResolvedValue([session]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'この見本をすべて消す' }));
    expect(api.deleteSampleSession).not.toHaveBeenCalled();
    vi.mocked(api.listSampleSessions).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '本当に消す(もう一度押す)' }));
    await waitFor(() => expect(api.deleteSampleSession).toHaveBeenCalledExactlyOnceWith('session'));
    await waitFor(() => expect(screen.queryByText('撮れた写真')).not.toBeInTheDocument());
  });
  it('shows running progress and stops capture', async () => {
    vi.mocked(api.listSampleSessions).mockResolvedValue([{ ...session, status: 'running' }]);
    mount();
    expect(await screen.findByText('撮影中')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('見本を撮る')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撮影を止める' }));
    await waitFor(() => expect(api.stopSampleSession).toHaveBeenCalledWith('session'));
  });
  it('refreshes running sessions every three seconds and loads the final frames', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.mocked(api.listSampleSessions).mockResolvedValue([{ ...session, status: 'running', frameCount: 0 }]);
    mount();
    await screen.findByText('撮影中');
    await screen.findByAltText('見本');
    const initialCalls = vi.mocked(api.listSampleFrames).mock.calls.length;
    vi.mocked(api.listSampleSessions).mockResolvedValue([{ ...session, status: 'completed', frameCount: 10 }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await screen.findByText('見本を撮る');
    await waitFor(() => expect(vi.mocked(api.listSampleFrames).mock.calls.length).toBeGreaterThan(initialCalls));
    expect(api.listSampleSessions).toHaveBeenCalledTimes(2);
  });
  it('opens full images and releases blob URLs', async () => {
    vi.mocked(api.listSampleSessions).mockResolvedValue([session]);
    const { unmount } = mount(); await screen.findByAltText('見本');
    fireEvent.click(screen.getByRole('button', { name: /を拡大/ }));
    expect(screen.getByRole('dialog', { name: '見本' })).toBeInTheDocument();
    await waitFor(() => expect(api.getSampleImage).toHaveBeenCalledWith('frame', 'full'));
    await waitFor(() => expect(screen.getAllByAltText('見本')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
