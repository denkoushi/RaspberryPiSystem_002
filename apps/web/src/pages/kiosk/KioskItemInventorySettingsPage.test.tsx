import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryImports, useInventoryMutations, useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';
import { captureSetupPinSession, clearSetupPin, sendSetupRequest } from '../../features/kiosk/inventory/setup/setupPinSession';
import { useArmedNfcRead } from '../../features/kiosk/inventory/setup/useArmedNfcRead';

import { KioskItemInventorySettingsPage } from './KioskItemInventorySettingsPage';

import type { NfcEvent } from '../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));

vi.mock('../../api/hooks', () => ({
  useVerifyKioskDueManagementAccessPassword: vi.fn(),
  useInventoryMutations: vi.fn(),
  useInventoryTags: vi.fn(() => ({ data: [{ id: 't1', uid: 'q1', kind: 'QUANTITY', quantity: 5, compartment: null }] })),
  useInventoryItems: vi.fn(() => ({ data: [], isLoading: false })),
  useInventoryLocations: vi.fn(() => ({ data: [] })),
  useInventoryImports: vi.fn(() => ({ data: [{ id: 'candidate-1', sourceItemId: 1, area: '加工機', category: null, note: null, createdAt: '2026-10-01T00:00:00Z', photos: [] }], isLoading: false })),
  useInventoryImportMessages: vi.fn(() => ({ data: [] })),
  useInventoryUnits: vi.fn(() => ({ data: [] })),
  useInventoryToolFieldOptions: vi.fn(() => ({ data: {} })),
  useInventoryToolFieldValues: vi.fn(() => ({ data: {} })),
}));
vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn((enabled: boolean) => (enabled ? nfc.event : null)),
}));
vi.mock('../../features/kiosk/inventory/setup/InventoryItemEditTab', () => ({
  InventoryItemEditTab: ({ accessPassword }: { accessPassword: string }) => <div>item-edit-open:{accessPassword}</div>
}));

function renderPage(state?: { importId: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[{ pathname: '/kiosk/inventory/settings', state }]}>
      <KioskItemInventorySettingsPage />
    </MemoryRouter>
    </QueryClientProvider>
  );
  return {
    ...view,
    queryClient,
    readTag: (uid: string, eventId: number) => {
      nfc.event = { uid, eventId, timestamp: new Date().toISOString() } as NfcEvent;
      view.rerender(
        <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/kiosk/inventory/settings']}>
          <KioskItemInventorySettingsPage />
        </MemoryRouter>
        </QueryClientProvider>
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
    clearSetupPin();
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
      renameArea: { mutateAsync: vi.fn(), isPending: false },
      dismissImport: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      restoreImport: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
      registerImport: { mutateAsync: vi.fn(), isPending: false },
      retryImport: { mutateAsync: vi.fn(), isPending: false },
      deleteImportPhoto: { mutateAsync: vi.fn(), isPending: false },
      reorderImportPhotos: { mutateAsync: vi.fn(), isPending: false },
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
    expect(useInventoryImports).toHaveBeenCalledWith('2520', true);
    expect(screen.getByRole('button', { name: '登録する' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'アイテム編集' }));
    expect(screen.getByText('item-edit-open:2520')).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole('button', { name: 'タグを追加' })[0]);
    press('数量のテンキー', '3');
    page.readTag('tag-already-on-reader', 1);
    fireEvent.click(screen.getByRole('button', { name: '次へ：タグをかざす' }));
    expect(screen.getByText('新しい数量タグ「3」')).toBeInTheDocument();
    expect(quantityTag).not.toHaveBeenCalled();

    await act(async () => { page.readTag('new-tag', 2); });

    await waitFor(() => expect(quantityTag).toHaveBeenCalledWith({ uid: 'new-tag', quantity: 3 }));
    expect(quantityTag).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('数量タグ「3」を登録しました')).toBeInTheDocument();
  });
  it('retains the registration candidate and draft when another tab unmounts registration', async () => {
    verify.mockResolvedValue({ success: true });
    renderPage();
    press('パスワードのテンキー', '2520');
    fireEvent.change(await screen.findByLabelText('アイテム名'), { target: { value: '入力中の治具' } });
    fireEvent.change(screen.getByLabelText('型式'), { target: { value: 'M-12' } });
    fireEvent.click(screen.getByRole('tab', { name: 'アイテム編集' }));
    expect(screen.queryByLabelText('アイテム名')).not.toBeInTheDocument();
    expect(screen.getByText('item-edit-open:2520')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '登録待ち' }));
    expect(screen.getByRole('button', { name: '候補 #1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('アイテム名')).toHaveValue('入力中の治具');
    expect(screen.getByLabelText('型式')).toHaveValue('M-12');
  });

  it('falls back to the newest candidate when the requested one is no longer waiting', async () => {
    verify.mockResolvedValue({ success: true });
    renderPage({ importId: 'already-registered' });
    press('パスワードのテンキー', '2520');
    expect(await screen.findByRole('button', { name: '候補 #1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '登録する' })).toBeInTheDocument();
  });

  it('remembers the PIN on reentry, refreshes activity, and expires after five idle minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verify.mockResolvedValue({ success: true });
      const first = renderPage();
      press('パスワードのテンキー', '2520');
      await screen.findByRole('tab', { name: '登録待ち' });
      first.unmount();
      act(() => vi.advanceTimersByTime(4 * 60_000));
      const second = renderPage();
      expect(screen.queryByRole('group', { name: 'パスワードのテンキー' })).not.toBeInTheDocument();
      expect(verify).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(4 * 60_000));
      fireEvent.click(screen.getByRole('tab', { name: 'アイテム編集' }));
      second.unmount();
      act(() => vi.advanceTimersByTime(4 * 60_000));
      const third = renderPage();
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      third.unmount();
      act(() => vi.advanceTimersByTime(5 * 60_000));
      renderPage();
      expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('locks manually and does not reuse the PIN afterward', async () => {
    verify.mockResolvedValue({ success: true });
    const page = renderPage();
    press('パスワードのテンキー', '2520');
    fireEvent.click(await screen.findByRole('button', { name: 'ロック' }));
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
    page.unmount();
    renderPage();
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
  });

  it.each([401, 403])('locks on an API query failure (%s)', async (status) => {
    verify.mockResolvedValue({ success: true });
    const page = renderPage();
    press('パスワードのテンキー', '2520');
    await screen.findByRole('tablist');
    await act(async () => {
      await page.queryClient.fetchQuery({ queryKey: ['inventory-imports'], queryFn: () => sendSetupRequest(captureSetupPinSession('2520'), () => Promise.reject({ response: { status } })) }).catch(() => undefined);
    });
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
    page.unmount();
    renderPage();
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
  });

  it('locks on an API mutation failure', async () => {
    verify.mockResolvedValue({ success: true });
    const page = renderPage();
    press('パスワードのテンキー', '2520');
    await screen.findByRole('tablist');
    await act(async () => {
      await page.queryClient.getMutationCache().build(page.queryClient, { mutationFn: () => sendSetupRequest(captureSetupPinSession('2520'), () => Promise.reject({ response: { status: 403 } })) }).execute(undefined).catch(() => undefined);
    });
    expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
  });

  it.each([401, 403])('keeps setup unlocked for unrelated query and mutation failures (%s)', async (status) => {
    verify.mockResolvedValue({ success: true });
    const page = renderPage();
    press('パスワードのテンキー', '2520');
    await screen.findByRole('tablist');
    await act(async () => {
      await page.queryClient.fetchQuery({ queryKey: ['unrelated'], queryFn: () => Promise.reject({ response: { status } }) }).catch(() => undefined);
      await page.queryClient.getMutationCache().build(page.queryClient, { mutationFn: () => Promise.reject({ response: { status } }) }).execute(undefined).catch(() => undefined);
    });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'パスワードのテンキー' })).not.toBeInTheDocument();
  });

  it('refreshes the remembered PIN for NFC activity in setup', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verify.mockResolvedValue({ success: true });
      const page = renderPage();
      press('パスワードのテンキー', '2520');
      fireEvent.click(await screen.findByRole('tab', { name: 'NFCタグ' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'タグを追加' })[0]);
      press('数量のテンキー', '3');
      fireEvent.click(screen.getByRole('button', { name: '次へ：タグをかざす' }));
      act(() => vi.advanceTimersByTime(4 * 60_000));
      await act(async () => { page.readTag('active-tag', 3); });
      act(() => vi.advanceTimersByTime(2 * 60_000));
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      expect(quantityTag).toHaveBeenCalledWith({ uid: 'active-tag', quantity: 3 });
    } finally { vi.useRealTimers(); }
  });

  it('does not extend the setup PIN for NFC activity on other screens', async () => {
    function OtherNfcScreen() { useArmedNfcRead(true); return <p>別の画面</p>; }
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      verify.mockResolvedValue({ success: true });
      const page = renderPage();
      press('パスワードのテンキー', '2520');
      await screen.findByRole('tablist');
      page.unmount();
      const other = render(<OtherNfcScreen />);
      act(() => vi.advanceTimersByTime(4 * 60_000));
      nfc.event = { uid: 'outside', eventId: 10, timestamp: '2026-10-08' } as NfcEvent;
      other.rerender(<OtherNfcScreen />);
      act(() => vi.advanceTimersByTime(2 * 60_000));
      other.unmount();
      renderPage();
      expect(screen.getByRole('group', { name: 'パスワードのテンキー' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

});
