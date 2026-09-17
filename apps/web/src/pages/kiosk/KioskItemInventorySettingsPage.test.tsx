import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';

import { KioskItemInventorySettingsPage } from './KioskItemInventorySettingsPage';

vi.mock('../../api/hooks', () => ({ useVerifyKioskDueManagementAccessPassword: vi.fn() }));
vi.mock('../admin/RaspiInventoryPage', () => ({
  RaspiInventoryPage: ({ accessPassword }: { accessPassword?: string }) => <div>settings-open:{accessPassword}</div>
}));

describe('KioskItemInventorySettingsPage', () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    mutateAsync.mockReset();
    vi.mocked(useVerifyKioskDueManagementAccessPassword).mockReturnValue({
      mutateAsync,
      isPending: false
    } as never);
  });

  it('verifies the shared four-digit password before opening inventory settings', async () => {
    mutateAsync.mockResolvedValue({ success: true });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('2520');
    try {
      render(
        <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
          <KioskItemInventorySettingsPage />
        </MemoryRouter>
      );

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ password: '2520' }));
      expect(screen.getByText('settings-open:2520')).toBeInTheDocument();
    } finally {
      prompt.mockRestore();
    }
  });

  it('rejects a non-four-digit password without calling the API', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('wrong');
    try {
      render(
        <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
          <KioskItemInventorySettingsPage />
        </MemoryRouter>
      );

      expect(await screen.findByRole('alert')).toHaveTextContent('操作パスワードは4桁の数字で入力してください');
      expect(mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '認証する' })).toBeInTheDocument();
    } finally {
      prompt.mockRestore();
    }
  });

  it('clears an authentication error after a few seconds', async () => {
    vi.useFakeTimers();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('wrong');
    try {
      render(
        <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
          <KioskItemInventorySettingsPage />
        </MemoryRouter>
      );

      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      prompt.mockRestore();
      vi.useRealTimers();
    }
  });
});
