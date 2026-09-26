import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryMutations, useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';

import { KioskItemInventorySettingsPage } from './KioskItemInventorySettingsPage';

import type { NfcEvent } from '../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));

vi.mock('../../api/hooks', () => ({
  useVerifyKioskDueManagementAccessPassword: vi.fn(),
  useInventoryMutations: vi.fn(),
  useInventoryTags: vi.fn(() => ({ data: [{ id: 't1', uid: 'q1', kind: 'QUANTITY', quantity: 5, compartment: null }] })),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryLocations: vi.fn(() => ({ data: [] })),
}));
vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn((enabled: boolean) => (enabled ? nfc.event : null)),
}));
vi.mock('../../features/kiosk/inventory/setup/InventoryRegistrationTab', () => ({
  InventoryRegistrationTab: ({ accessPassword }: { accessPassword: string }) => <div>registration-open:{accessPassword}</div>
}));
vi.mock('../admin/RaspiInventoryPage', () => ({
  RaspiInventoryPage: ({ accessPassword }: { accessPassword?: string }) => <div>settings-open:{accessPassword}</div>
}));

function renderPage() {
  const view = render(
    <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
      <KioskItemInventorySettingsPage />
    </MemoryRouter>
  );
  return {
    ...view,
    readTag: (uid: string, eventId: number) => {
      nfc.event = { uid, eventId, timestamp: new Date().toISOString() } as NfcEvent;
      view.rerender(
        <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
          <KioskItemInventorySettingsPage />
        </MemoryRouter>
      );
    },
  };
}

function press(groupName: string, digits: string) {
  const group = screen.getByRole('group', { name: groupName });
  for (const digit of digits) {
    fireEvent.click(Array.from(group.querySelectorAll('button')).find((button) => button.textContent === digit)!);
  }
}

describe('KioskItemInventorySettingsPage', () => {
  const verify = vi.fn();
  const quantityTag = vi.fn();

  beforeEach(() => {
    nfc.event = null;
    verify.mockReset();
    quantityTag.mockReset().mockResolvedValue({});
    vi.mocked(useVerifyKioskDueManagementAccessPassword).mockReturnValue({ mutateAsync: verify, isPending: false } as never);
    vi.mocked(useInventoryMutations).mockReturnValue({
      quantityTag: { mutateAsync: quantityTag, isPending: false },
      restockTag: { mutateAsync: vi.fn(), isPending: false },
      replaceTag: { mutateAsync: vi.fn(), isPending: false },
      createShelf: { mutateAsync: vi.fn(), isPending: false },
      createDrawer: { mutateAsync: vi.fn(), isPending: false },
    } as never);
  });

  it('verifies the shared four-digit password typed on the keypad before opening setup', async () => {
    verify.mockResolvedValue({ success: true });
    const prompt = vi.spyOn(window, 'prompt');
    renderPage();

    press('パスワードのテンキー', '2520');

    await waitFor(() => expect(verify).toHaveBeenCalledWith({ password: '2520' }));
    expect(prompt).not.toHaveBeenCalled();
    expect(await screen.findByRole('tab', { name: '登録待ち' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('registration-open:2520')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'アイテム編集' }));
    expect(screen.getByText('settings-open:2520')).toBeInTheDocument();
    prompt.mockRestore();
  });

  it('shows a wrong password next to the keypad and starts over', async () => {
    verify.mockResolvedValue({ success: false });
    renderPage();

    press('パスワードのテンキー', '0000');

    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードが違います');
    expect(screen.getByLabelText('0桁入力済み')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('clears an authentication error after a few seconds', async () => {
    verify.mockResolvedValue({ success: false });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      press('パスワードのテンキー', '0000');
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('registers a quantity tag by holding it, without a read button, ignoring an earlier read', async () => {
    verify.mockResolvedValue({ success: true });
    const page = renderPage();
    press('パスワードのテンキー', '2520');
    fireEvent.click(await screen.findByRole('tab', { name: 'NFCタグ' }));
    expect(screen.getByText('5')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '＋ タグを追加' })[0]);
    press('数量のテンキー', '3');
    page.readTag('tag-already-on-reader', 1);
    fireEvent.click(screen.getByRole('button', { name: '次へ：タグをかざす' }));
    expect(screen.getByText('新しいタグをリーダーにかざしてください')).toBeInTheDocument();
    expect(quantityTag).not.toHaveBeenCalled();

    await act(async () => { page.readTag('new-tag', 2); });

    await waitFor(() => expect(quantityTag).toHaveBeenCalledWith({ uid: 'new-tag', quantity: 3 }));
    expect(quantityTag).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('数量タグ「3個」を登録しました')).toBeInTheDocument();
  });
});
