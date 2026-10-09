import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), open: vi.fn(), reply: vi.fn(), read: null as { uid: string; eventId: number } | null, armed: vi.fn()
}));
vi.mock('../../../api/client', () => ({
  listKioskInquiries: mocks.list, openKioskInquiry: mocks.open, replyToKioskInquiry: mocks.reply
}));
vi.mock('../inventory/setup/useArmedNfcRead', () => ({
  useArmedNfcRead: (armed: boolean) => { mocks.armed(armed); if (!armed) mocks.read = null; return armed ? mocks.read : null; }
}));

import { KioskInquiryInbox } from './KioskInquiryInbox';

const thread = {
  id: 'thread-1', senderClientDeviceName: '加工キオスク', senderLocation: '第2工場', page: '/kiosk',
  unread: true, lastMessageAt: '2026-10-09T01:42:00.000Z',
  lastMessage: { side: 'SENDER' as const, body: '確認をお願いします', createdAt: '2026-10-09T01:42:00.000Z' }
};
const detail = {
  thread: { ...thread, unread: false },
  messages: [{ id: 'message-1', ...thread.lastMessage }]
};
function renderInbox(isReceiver = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(['kiosk-inquiry-summary', 'device'], { isReceiver, unreadCount: 1 });
  const ui = <KioskInquiryInbox clientKey="device" isReceiver={isReceiver} />;
  const view = render(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> });
  return { ...view, queryClient, touch: (uid = 'allowed') => {
    mocks.read = { uid, eventId: (mocks.read?.eventId ?? 0) + 1 };
    view.rerender(<KioskInquiryInbox clientKey="device" isReceiver={isReceiver} />);
  }, ui };
}
const denied = { isAxiosError: true, response: { status: 403, data: { errorCode: 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED' } } };

beforeEach(() => {
  mocks.read = null;
  mocks.armed.mockReset();
  mocks.list.mockReset().mockResolvedValue({ threads: [thread] });
  mocks.open.mockReset().mockResolvedValue(detail);
  mocks.reply.mockReset().mockImplementation(async (_id: string, body: string) => ({
    thread: { ...detail.thread, lastMessage: { side: 'RECEIVER', body, createdAt: thread.lastMessageAt } },
    messages: [...detail.messages, { id: 'message-2', side: 'RECEIVER', body, createdAt: thread.lastMessageAt }]
  }));
});

describe('KioskInquiryInbox', () => {
  it('hides receiver inquiries and arms NFC before an employee card is touched', () => {
    renderInbox();
    expect(screen.getByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('rejects an unauthorized card and accepts a subsequent touch', async () => {
    mocks.list.mockRejectedValueOnce(denied);
    const view = renderInbox();
    view.touch('denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('この社員証では開けません');
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
    view.touch();
    expect(await screen.findByText('加工キオスク')).toBeInTheDocument();
    expect(screen.queryByText('社員証をタッチ')).not.toBeInTheDocument();
  });

  it('unlocks, opens a thread, updates unread count and sends a reply with the in-memory credential', async () => {
    const view = renderInbox();
    view.touch();
    fireEvent.click(await screen.findByRole('button', { name: /加工キオスク/ }));
    expect(await screen.findByRole('textbox', { name: '返信' })).toHaveAttribute('maxlength', '500');
    expect(mocks.open).toHaveBeenCalledWith('thread-1', 'allowed', expect.any(AbortSignal));
    expect(view.queryClient.getQueryData(['kiosk-inquiry-summary', 'device'])).toEqual({ isReceiver: true, unreadCount: 0 });
    fireEvent.change(screen.getByRole('textbox', { name: '返信' }), { target: { value: '向かいます' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByText('向かいます')).toHaveClass('kiosk-inquiry__message--mine');
    expect(mocks.reply).toHaveBeenCalledWith('thread-1', '向かいます', 'allowed', expect.any(AbortSignal));
    expect(mocks.list.mock.calls.every(call => call[0] === 'allowed')).toBe(true);
    expect(mocks.armed).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }));
    expect(await screen.findByText('加工キオスク')).toBeInTheDocument();
  });

  it('shows sender inquiries without NFC and sends a quick reply without a credential', async () => {
    renderInbox(false);
    fireEvent.click(await screen.findByRole('button', { name: /確認をお願いします/ }));
    fireEvent.click(await screen.findByRole('button', { name: '了解です' }));
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith('thread-1', '了解です', undefined, expect.any(AbortSignal)));
    expect(mocks.list).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(mocks.open).toHaveBeenCalledWith('thread-1', undefined, expect.any(AbortSignal));
    expect(screen.queryByText('社員証をタッチ')).not.toBeInTheDocument();
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(false);
  });

  it('clears the credential and cached list on unmount, requiring a fresh card on reopening', async () => {
    const view = renderInbox();
    view.touch();
    await screen.findByText('加工キオスク');
    view.unmount();
    expect(view.queryClient.getQueriesData({ queryKey: ['kiosk-inquiries'] })).toEqual([]);
    mocks.read = null;
    renderInbox();
    expect(screen.getByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
  });

  it('ignores authentication that completes after the inbox closes', async () => {
    let resolve: (value: { threads: typeof thread[] }) => void = () => undefined;
    mocks.list.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = renderInbox();
    view.touch();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    const signal = mocks.list.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ threads: [thread] }));
    expect(view.queryClient.getQueriesData({ queryKey: ['kiosk-inquiries'] })).toEqual([]);
  });

  it('shows an empty inbox', async () => {
    mocks.list.mockResolvedValue({ threads: [] });
    renderInbox(false);
    expect(await screen.findByText('お問い合わせはありません')).toBeInTheDocument();
  });

  it('keeps a failed reply and its error next to the composer', async () => {
    mocks.reply.mockRejectedValue(new Error('network'));
    renderInbox(false);
    fireEvent.click(await screen.findByRole('button', { name: /確認をお願いします/ }));
    const input = await screen.findByRole('textbox', { name: '返信' });
    fireEvent.change(input, { target: { value: '再送する文' } });
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('返信を送信できません');
    expect(input).toHaveValue('再送する文');
  });
});
