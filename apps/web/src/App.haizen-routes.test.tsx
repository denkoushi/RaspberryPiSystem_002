import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api/http';
import App from './App';

import type { HaizenOrderTrail } from './features/kiosk/haizen/haizenRecordTypes';
import type { ReactNode } from 'react';

vi.mock('./api/http', async importOriginal => ({ ...await importOriginal<typeof import('./api/http')>(), api: { get: vi.fn() } }));
vi.mock('./layouts/KioskLayout', () => ({ KioskLayout: () => <main data-testid="kiosk-layout"><Outlet /></main> }));
vi.mock('./features/webrtc/components/CallAutoSwitchLayout', () => ({ CallAutoSwitchLayout: () => <Outlet /> }));
vi.mock('./features/mobile-placement/sync/MobileSyncProvider', () => ({ MobileSyncProvider: ({ children }: { children: ReactNode }) => <div data-testid="mobile-sync">{children}</div> }));
vi.mock('./features/mobile-placement/part-search/offline/PlacementDeleteSyncJob', () => ({ PlacementDeleteSyncJob: () => null }));
vi.mock('./features/mobile-app-shell/registerMobileAppShell', () => ({ registerMobileAppShell: () => undefined }));
vi.mock('./components/hermes/HermesPageContext', () => ({ HermesPageContextProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./components/hermes/HermesFloatingChat', () => ({ HermesFloatingChat: () => null }));
vi.mock('./features/kiosk/screen-watch/KioskScreenWatchHost', () => ({ KioskScreenWatchHost: () => null }));
const trail: HaizenOrderTrail = {
  orderNo: '0002178005', fhinmei: 'ブラケット', machineName: '機械', fseiban: 'FS1', fhincd: 'P1',
  currentShelves: [{ shelfCodeRaw: '北1', branchNo: 0 }], steps: [], events: []
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.get).mockImplementation(async url => {
    if (url === '/mobile-placement/order-trail') return { data: { trail } };
    if (url === '/mobile-placement/verify-records') return { data: { records: [] } };
    return { data: { shelves: [{ shelfCodeRaw: '北1', displayLabel: '北の棚' }] } };
  });
});
afterEach(() => { cleanup(); client.clear(); });
const mount = (path: string) => render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);

describe('App haizen routes', () => {
  it('renders verify history inside the kiosk and sync layouts with its API hook', async () => {
    mount('/kiosk/inventory/haizen/verify-history');
    expect(await screen.findByText('記録はありません')).toBeInTheDocument();
    expect(within(screen.getByTestId('kiosk-layout')).getByRole('heading', { name: '照合の記録' })).toBeInTheDocument();
    expect(within(screen.getByTestId('mobile-sync')).getByRole('heading', { name: '照合の記録' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/mobile-placement/verify-records', { params: { days: 7 } });
  });
  it('renders a trail from the order query and keeps shelf links amber', async () => {
    mount('/kiosk/inventory/haizen/trail?order=0002178005');
    expect(await screen.findByRole('heading', { name: 'ブラケット 機械' })).toBeInTheDocument();
    expect(within(screen.getByTestId('kiosk-layout')).getByRole('heading', { name: '足取り' })).toBeInTheDocument();
    expect(within(screen.getByTestId('mobile-sync')).getByRole('heading', { name: '足取り' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/mobile-placement/order-trail', { params: { order: '0002178005' } });
    const shelf = screen.getByRole('link', { name: '北の棚 分配なし' });
    expect(shelf).toHaveAttribute('href', '/kiosk/inventory/haizen');
    expect(shelf).toHaveClass('!border-inv-amber', '!text-inv-amber');
  });
});
