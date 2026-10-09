import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskConfig } from '../../api/hooks/kiosk';

import { KioskInitialRouteButton } from './KioskInitialRouteButton';

import type { KioskConfig } from '../../api/domains/kiosk';
import type { KioskInitialRouteId } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('../../api/client', () => ({ putKioskInitialRoute: mocks.put, getKioskConfig: mocks.get }));
vi.mock('../../api/hooks', async () => {
  const hooks = await import('../../api/hooks/kiosk');
  return { useUpdateKioskInitialRoute: hooks.useUpdateKioskInitialRoute };
});

let serverConfig: KioskConfig;
let queryClient: QueryClient;
function Harness({ pathname, hidden = false }: { pathname: string; hidden?: boolean }) {
  const { data } = useKioskConfig();
  const client = useQueryClient();
  return <>
    <header aria-hidden={hidden} style={{ transform: hidden ? 'translateY(100%)' : undefined }}>
      <KioskInitialRouteButton clientKey="self-device-key" pathname={pathname} initialKioskRoute={data?.initialKioskRoute} defaultMode={data?.defaultMode} />
    </header>
    <div data-testid="config">{String(client.getQueryData<KioskConfig>(['kiosk-config'])?.initialKioskRoute)}</div>
    <div data-testid="pathname">{pathname}</div>
  </>;
}
function mount(pathname = '/kiosk/assembly', initialRoute: KioskInitialRouteId | null = null, defaultMode: 'TAG' | 'PHOTO' = 'TAG') {
  serverConfig = { theme: '', greeting: '', idleTimeoutMs: 30000, defaultMode, initialKioskRoute: initialRoute };
  queryClient.setQueryData(['kiosk-config'], serverConfig);
  return render(<QueryClientProvider client={queryClient}><Harness pathname={pathname} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.get.mockImplementation(() => Promise.resolve(serverConfig));
  mocks.put.mockImplementation(async (initialRoute: KioskInitialRouteId | null) => {
    serverConfig = { ...serverConfig, initialKioskRoute: initialRoute, initialKioskPath: '/resolved-path' };
    return { ok: true, initialKioskRoute: initialRoute, initialKioskPath: '/resolved-path' };
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(122);
});
afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('kiosk start page control', () => {
  it('shows an outlined 44px icon and saves once using the self device key without navigation', async () => {
    mount();
    const button = screen.getByRole('button', { name: 'この画面を開始ページにする' });
    expect(button).toHaveClass('h-11', 'w-11', 'border-inv-line2');
    expect(button).toHaveAttribute('title', 'この画面を開始ページにする');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('svg')).toHaveAttribute('fill', 'none');
    expect(button).not.toHaveTextContent(/./);
    fireEvent.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent('起動時に「組立」を開きます');
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('assembly', 'self-device-key');
    expect(screen.getByTestId('config')).toHaveTextContent('assembly');
    expect(queryClient.getQueryData<KioskConfig>(['kiosk-config'])?.initialKioskPath).toBe('/resolved-path');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/kiosk/assembly');
    expect(screen.getByRole('button', { name: 'この画面が開始ページです' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([null, 'documents'] as const)('undo restores the exact previous setting %s', async (previous) => {
    mount('/kiosk/assembly', previous);
    fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' }));
    fireEvent.click(await screen.findByRole('button', { name: '元に戻す' }));
    await waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith(previous, 'self-device-key'));
    expect(await screen.findByText('開始ページを元に戻しました')).toBeInTheDocument();
    expect(queryClient.getQueryData<KioskConfig>(['kiosk-config'])?.initialKioskRoute).toBe(previous);
  });

  it.each([
    ['/kiosk/assembly/manuals', 'assembly', 'TAG'],
    ['/kiosk/photo', null, 'PHOTO'],
    ['/kiosk/tag', null, 'TAG']
  ] as const)('shows the effective startup page on %s without saving again', async (pathname, route, mode) => {
    mount(pathname, route, mode);
    const button = screen.getByRole('button', { name: 'この画面が開始ページです' });
    expect(button).toHaveClass('border-inv-cyan', 'text-inv-cyan');
    expect(button.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveTextContent('この画面が開始ページです');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it.each([
    ['/kiosk/tag-desk', 'PIN の画面は開始ページにできません'],
    ['/kiosk/production-schedule/due-management', 'PIN の画面は開始ページにできません'],
    ['/kiosk/not-a-tab', 'この画面は開始ページにできません']
  ])('blocks %s with a notice', (pathname, message) => {
    mount(pathname);
    const button = screen.getByRole('button', { name: message });
    expect(button).toHaveClass('text-inv-faint');
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it.each([
    ['/kiosk/photo', 'borrow_photo'], ['/kiosk/tag', 'borrow_tag'], ['/kiosk', 'borrow_tag'],
    ['/kiosk/part-measurement/self-inspection/records', 'self_inspection']
  ])('resolves the current tab on %s to %s', async (pathname, route) => {
    mount(pathname, 'assembly', 'PHOTO');
    fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(route, 'self-device-key'));
  });

  it('shows a save failure without an alert or changing the cached value', async () => {
    const alert = vi.spyOn(window, 'alert');
    mocks.put.mockRejectedValueOnce(new Error('network'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' }));
    expect(await screen.findByRole('status')).toHaveTextContent('開始ページを保存できませんでした');
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
    expect(queryClient.getQueryData<KioskConfig>(['kiosk-config'])?.initialKioskRoute).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('shows an undo failure in the same notice area', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' }));
    const undo = await screen.findByRole('button', { name: '元に戻す' });
    mocks.put.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(undo);
    expect(await screen.findByText('開始ページを保存できませんでした')).toBeInTheDocument();
    expect(queryClient.getQueryData<KioskConfig>(['kiosk-config'])?.initialKioskRoute).toBe('assembly');
  });

  it('keeps the notice outside the transformed, hidden dock and expires it after six seconds', async () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' }));
    const notice = await screen.findByRole('status');
    expect(notice.parentElement).toBe(document.body);
    expect(notice).toHaveStyle({ bottom: '138px' });
    view.rerender(<QueryClientProvider client={queryClient}><Harness pathname="/kiosk/assembly" hidden /></QueryClientProvider>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    vi.useFakeTimers();
    // Create a fresh success notification with a timer controlled by fake time.
    queryClient.setQueryData(['kiosk-config'], { ...serverConfig, initialKioskRoute: null });
    view.rerender(<QueryClientProvider client={queryClient}><Harness pathname="/kiosk/documents" /></QueryClientProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'この画面を開始ページにする' })); });
    act(() => { vi.advanceTimersByTime(5999); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('expires notices that do not save after three seconds', () => {
    mount('/kiosk/tag');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'この画面が開始ページです' }));
    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
