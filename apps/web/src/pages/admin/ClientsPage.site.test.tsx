import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z'
      }
    ]
  }),
  useClientStatuses: () => ({ data: [], isError: false, isLoading: false }),
  useClientLogs: () => ({ data: [], isError: false, isLoading: false }),
  useClientMutations: () => ({ update: { mutateAsync, isPending: false } }),
  useSites: () => ({ isError: false, data: [{ key: '第2工場', displayName: '第2工場', sortOrder: 0 }] }),
  useCreateSite: () => ({ mutateAsync: createSiteAsync, isPending: false })
}));
vi.mock('../../components/signage/SignagePdfManager', () => ({ SignagePdfManager: () => null }));

import { ClientsPage } from './ClientsPage';

describe('ClientsPage site assignment', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    createSiteAsync.mockClear();
  });

  it('shows the explicit site or the location-derived guess and the proxy capability', () => {
    render(<ClientsPage />);
    expect(screen.getByText('未設定（推測: Mac）')).toBeInTheDocument();
    expect(screen.getAllByText('第2工場').length).toBeGreaterThan(0);
  });

  it('saves the chosen site and proxy capability for a device', async () => {
    render(<ClientsPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.change(screen.getByLabelText('拠点'), { target: { value: '第2工場' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'mac',
      payload: expect.objectContaining({ siteKey: '第2工場', canProxyOtherDevices: true })
    });
  });

  it('rejects a site name containing the location delimiter before calling the API', async () => {
    render(<ClientsPage />);
    fireEvent.change(screen.getByLabelText('新しい拠点名'), { target: { value: 'A - B' } });
    fireEvent.click(screen.getByRole('button', { name: '拠点を追加' }));
    expect(await screen.findByText('拠点名に「 - 」は使えません。')).toBeInTheDocument();
    expect(createSiteAsync).not.toHaveBeenCalled();
  });
});
