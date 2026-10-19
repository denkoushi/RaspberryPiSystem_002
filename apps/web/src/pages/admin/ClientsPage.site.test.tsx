import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn(async () => ({}));
const createSiteAsync = vi.fn(async () => ({}));

vi.mock('../../api/hooks', () => ({
  useClients: () => ({
    isError: false,
    isLoading: false,
    data: [
      {
        id: 'mac',
        name: 'Mac',
        location: null,
        apiKey: 'client-key-mac-kiosk1',
        siteKey: null,
        canProxyOtherDevices: true,
        kioskInitialRoute: 'assembly',
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z'
      },
      {
        id: 'kiosk',
        name: 'raspi4-sessaku-01',
        location: '第2工場 - Sessaku-01',
        apiKey: 'client-key-raspi4-sessaku-01-kiosk1',
        siteKey: '第2工場',
        canProxyOtherDevices: false,
        statusClientId: 'raspi4-sessaku-01',
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z'
      }
    ]
  }),
  useClientStatuses: () => ({
    isError: false,
    isLoading: false,
    data: [
      {
        clientId: 'raspi4-sessaku-01',
        hostname: 'sessaku-01-host',
        ipAddress: '100.64.0.10',
        cpuUsage: 12,
        memoryUsage: 40,
        diskUsage: 30,
        temperature: 50,
        uptimeSeconds: 7200,
        lastSeen: '2026-10-02T03:00:00Z',
        stale: false,
        latestLogs: [{ level: 'ERROR', message: 'NFCリーダー切断', createdAt: '2026-10-02T02:59:00Z' }]
      },
      {
        clientId: 'raspi5-server',
        hostname: 'raspi5-server',
        ipAddress: '100.64.0.1',
        cpuUsage: 20,
        memoryUsage: 50,
        diskUsage: 60,
        temperature: 55,
        uptimeSeconds: 3600,
        lastSeen: '2026-10-02T03:00:00Z',
        stale: false,
        latestLogs: []
      }
    ]
  }),
  useClientLogs: () => ({ data: [], isError: false, isLoading: false }),
  useClientMutations: () => ({ update: { mutateAsync, isPending: false } }),
  useSites: () => ({ isError: false, data: [{ key: '第2工場', displayName: '第2工場', sortOrder: 0 }] }),
  useCreateSite: () => ({ mutateAsync: createSiteAsync, isPending: false })
}));

import { ClientsPage } from './ClientsPage';

const settings = () => within(screen.getByRole('region', { name: '端末の設定' }));

describe('ClientsPage', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    createSiteAsync.mockClear();
  });

  it('marks a device without a site and warns in its settings', () => {
    render(<ClientsPage />);
    expect(screen.getByRole('button', { name: /拠点未設定/ })).toHaveTextContent('1');
    expect(settings().getByText('未設定だと製番ボードなどを開けません')).toBeInTheDocument();
  });

  it('keeps the save button on screen and saves a changed start screen', async () => {
    render(<ClientsPage />);
    const save = settings().getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    fireEvent.change(settings().getByLabelText('起動先'), { target: { value: 'borrow_tag' } });
    expect(settings().getByRole('status')).toHaveTextContent('起動先: 組立 → 2タグスキャン');
    fireEvent.click(save);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'mac',
      payload: expect.objectContaining({ kioskInitialRoute: 'borrow_tag', name: 'Mac' })
    });
    expect(await settings().findByText('保存しました')).toBeInTheDocument();
  });

  it('saves the chosen site and proxy capability for a device', async () => {
    render(<ClientsPage />);
    fireEvent.change(settings().getByLabelText('拠点'), { target: { value: '第2工場' } });
    fireEvent.click(settings().getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'mac',
      payload: expect.objectContaining({ siteKey: '第2工場', canProxyOtherDevices: true })
    });
  });

  it('keeps an unsaved edit when another device is opened', () => {
    render(<ClientsPage />);
    fireEvent.click(settings().getByRole('switch', { name: '棚レイアウト編集を許可' }));
    fireEvent.click(screen.getByRole('button', { name: /raspi4-sessaku-01/ }));
    expect(settings().getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Mac.*未保存/ }));
    expect(settings().getByRole('switch', { name: '棚レイアウト編集を許可' })).toBeChecked();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('joins the status report to its device and lists reports without a device', () => {
    render(<ClientsPage />);
    expect(screen.getByRole('button', { name: /エラーあり/ })).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /raspi4-sessaku-01/ }));
    expect(settings().getByText('オンライン')).toBeInTheDocument();
    expect(settings().getByText('NFCリーダー切断')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /raspi5-server/ }));
    expect(settings().getByText('台帳にない端末です（稼働状況のみ）。')).toBeInTheDocument();
    expect(settings().queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('rejects a site name containing the location delimiter before calling the API', async () => {
    render(<ClientsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '拠点' }));
    fireEvent.change(screen.getByLabelText('新しい拠点名'), { target: { value: 'A - B' } });
    fireEvent.click(screen.getByRole('button', { name: '拠点を追加' }));
    expect(await screen.findByText('拠点名に「 - 」は使えません。')).toBeInTheDocument();
    expect(createSiteAsync).not.toHaveBeenCalled();
  });
});
