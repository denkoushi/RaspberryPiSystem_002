import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(), list: vi.fn(), open: vi.fn(), reply: vi.fn(), readAll: vi.fn(), summary: vi.fn(),
  read: null as { uid: string; eventId: number } | null, armed: vi.fn()
}));
vi.mock('../../../api/client', () => ({
  postKioskSupport: mocks.post, listKioskInquiries: mocks.list, openKioskInquiry: mocks.open, replyToKioskInquiry: mocks.reply,
  markAllKioskInquiriesRead: mocks.readAll, getKioskInquirySummary: mocks.summary
}));
vi.mock('../../../api/hooks', () => ({ useKioskEmployees: () => ({ data: [{ id: 'e1', displayName: '機械 一郎', section: '機械課', department: null }], isLoading: false }) }));
vi.mock('../inventory/setup/useArmedNfcRead', () => ({
  useArmedNfcRead: (armed: boolean) => { mocks.armed(armed); if (!armed) mocks.read = null; return armed ? mocks.read : null; }
}));

vi.mock('../screen-watch/startWatch', () => ({ startWatch: vi.fn() }));

import { useKioskInquirySummary } from '../../../api/hooks/kiosk';
import { kioskQueryKeys } from '../../../api/queryKeys/kiosk';
import { startWatch } from '../screen-watch/startWatch';

import { KioskInquiryInbox } from './KioskInquiryInbox';

import type { KioskInquirySummary } from '../../../api/domains/kiosk';

const thread = {
  id: 'thread-1', senderClientDeviceName: '加工キオスク', senderLocation: '第2工場', page: '/kiosk',
  unread: true, lastMessageAt: '2026-10-09T01:42:00.000Z',
  lastMessage: { side: 'SENDER' as const, body: '確認をお願いします', createdAt: '2026-10-09T01:42:00.000Z' }
};
const elsewhere = { id: 'outside-list', lastMessageAt: '2026-10-09T01:40:00.000Z' };
const detail = {
  thread: { ...thread, unread: false },
  messages: [{ id: 'message-1', ...thread.lastMessage }]
};
function renderInbox(isReceiver = true, loginUnlock = false, unreadCount = 1) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(kioskQueryKeys.inquirySummary('device'), { isReceiver, unreadCount });
  const ui = <KioskInquiryInbox clientKey="device" isReceiver={isReceiver} loginUnlock={loginUnlock} />;
  const view = render(ui, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/kiosk/borrow']}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter> });
  return { ...view, queryClient, touch: (uid = 'allowed') => {
    mocks.read = { uid, eventId: (mocks.read?.eventId ?? 0) + 1 };
    view.rerender(<KioskInquiryInbox clientKey="device" isReceiver={isReceiver} loginUnlock={loginUnlock} />);
  }, ui };
}
const denied = { isAxiosError: true, response: { status: 403, data: { errorCode: 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED' } } };

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ requestId: 'req', threadId: 'new-thread' });
  mocks.read = null;
  mocks.armed.mockReset();
  mocks.list.mockReset().mockResolvedValue({ threads: [thread], unreadElsewhere: [] });
  mocks.open.mockReset().mockResolvedValue(detail);
  mocks.readAll.mockReset().mockResolvedValue({ updatedCount: 1 });
  mocks.summary.mockReset().mockResolvedValue({ isReceiver: true, unreadCount: 1 });
  mocks.reply.mockReset().mockImplementation(async (_id: string, body: string) => ({
    thread: { ...detail.thread, lastMessage: { side: 'RECEIVER', body, createdAt: thread.lastMessageAt } },
    messages: [...detail.messages, { id: 'message-2', side: 'RECEIVER', body, createdAt: thread.lastMessageAt }]
  }));
});

describe('KioskInquiryInbox', () => {
  it.each([
    [true, 'INQUIRY', '加工キオスク', true],
    [false, 'INQUIRY', '加工キオスク', false],
    [true, 'SYSTEM_NOTICE', '加工キオスク', false],
    [true, 'INQUIRY', null, false]
  ])('gates watch button by permission and sender (%s, %s, %s)', async (canViewScreen, kind, senderClientDeviceName, visible) => {
    mocks.open.mockResolvedValue({ ...detail, canViewScreen, thread: { ...detail.thread, isReceiver: true, kind, senderClientDeviceName } });
    mocks.reply.mockResolvedValue({ ...detail, thread: { ...detail.thread, isReceiver: true, kind, senderClientDeviceName } });
    const view = renderInbox(); view.touch();
    fireEvent.click(await screen.findByRole('button', { name: /加工キオスク/ }));
    await screen.findByRole('textbox', { name: '返信' });
    const button = screen.queryByRole('button', { name: '画面を見る' });
    expect(Boolean(button)).toBe(visible);
    if (button) {
      fireEvent.click(button);
      expect(startWatch).toHaveBeenCalledWith('thread-1', 'allowed', '加工キオスク');
      fireEvent.click(screen.getByRole('button', { name: '行きます' }));
      await waitFor(() => expect(mocks.reply).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: '画面を見る' })).toBeInTheDocument();
    }
  });

  it.each([null, '2026-10-13T00:00:00Z'])('shows the system notice title and status tag (%s)', async (noticeResolvedAt) => {
    const notice = { ...thread, kind: 'SYSTEM_NOTICE', noticeTitle: 'StoneBase01 バーコードリーダー', noticeResolvedAt,
      senderClientDeviceName: null, senderLocation: null, isReceiver: true };
    mocks.list.mockResolvedValue({ threads: [notice], unreadElsewhere: [] });
    mocks.open.mockResolvedValue({ thread: notice, messages: [{ id: 'system', side: 'SYSTEM', body: 'バーコードリーダーが応答しません。', createdAt: thread.lastMessageAt }] });
    const view = renderInbox(); view.touch();
    expect(await screen.findByText(noticeResolvedAt ? '復旧' : 'システム')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /StoneBase01 バーコードリーダー/ }));
    expect(await screen.findByText('バーコードリーダーが応答しません。')).toBeInTheDocument();
    expect(screen.getByText(noticeResolvedAt ? '復旧' : 'システム')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '返信' })).toBeEnabled();
  });

  it('sends from a locked receiver without a card and returns to the lock', async () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新規' }));
    expect(mocks.armed).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '機械 一郎' }));
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('送信しました');
    expect(mocks.post).toHaveBeenCalledWith({ message: '送信者: 機械 一郎\n依頼内容: 現場まで来てください。', page: '/kiosk/borrow' }, 'device');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('starts on the send form when asked, without arming NFC, and returns to the lock', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<KioskInquiryInbox clientKey="device" isReceiver startComposing />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/kiosk/borrow']}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></MemoryRouter> });
    expect(screen.queryByText('社員証をタッチ')).not.toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }));
    expect(screen.getByText('社員証をタッチ')).toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('returns from compose to the receiver lock without sending', () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新規' }));
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }));
    expect(screen.getByText('社員証をタッチ')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('refreshes the sender list and opens the created thread', async () => {
    renderInbox(false);
    await screen.findByText('確認をお願いします');
    const before = mocks.list.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '＋ 新規' }));
    fireEvent.click(screen.getByRole('button', { name: '機械 一郎' }));
    fireEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('textbox', { name: '返信' })).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith({ message: '送信者: 機械 一郎\n依頼内容: 現場まで来てください。', page: '/kiosk/borrow' }, 'device');
    expect(mocks.open).toHaveBeenCalledWith('new-thread', undefined, expect.any(AbortSignal));
    expect(mocks.list.mock.calls.length).toBeGreaterThan(before);
  });

  it('relocks a receiver when thread access expires', async () => {
    const view = renderInbox();
    view.touch();
    mocks.open.mockRejectedValueOnce(denied);
    fireEvent.click(await screen.findByRole('button', { name: /加工キオスク/ }));
    expect(await screen.findByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('この社員証では開けません');
    expect(view.queryClient.getQueriesData({ queryKey: ['kiosk-inquiries'] }).map(([, data]) => data)).toEqual([undefined]);
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('opens a login-unlocked receiver list without a card or arming NFC', async () => {
    renderInbox(true, true);
    expect(await screen.findByText('加工キオスク')).toBeInTheDocument();
    expect(screen.queryByText('社員証をタッチ')).not.toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(false);
    expect(mocks.list).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: /加工キオスク/ }));
    fireEvent.click(await screen.findByRole('button', { name: '行きます' }));
    await waitFor(() => expect(mocks.reply).toHaveBeenCalledWith('thread-1', '行きます', undefined, expect.any(AbortSignal)));
    expect(mocks.open).toHaveBeenCalledWith('thread-1', undefined, expect.any(AbortSignal));
  });

  it.each(['list', 'open', 'reply'] as const)('relocks with a login prompt on login-unlocked %s access errors', async action => {
    const failure = { isAxiosError: true, response: { status: 401, data: { errorCode: 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED' } } };
    if (action === 'list') mocks.list.mockRejectedValueOnce(failure);
    if (action === 'open') mocks.open.mockRejectedValueOnce(denied);
    if (action === 'reply') mocks.reply.mockRejectedValueOnce(failure);
    renderInbox(true, true);
    if (action !== 'list') fireEvent.click(await screen.findByRole('button', { name: /加工キオスク/ }));
    if (action === 'reply') fireEvent.click(await screen.findByRole('button', { name: '行きます' }));
    expect(await screen.findByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ログインし直してください');
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('hides receiver inquiries and arms NFC before an employee card is touched', () => {
    renderInbox();
    expect(screen.getByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'すべて既読' })).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.armed).toHaveBeenLastCalledWith(true);
  });

  it('hides read-all when neither the displayed rows nor unreadElsewhere has unread threads', async () => {
    mocks.list.mockResolvedValue({ threads: [detail.thread], unreadElsewhere: [] });
    renderInbox(true, true);
    await screen.findByText('加工キオスク');
    expect(screen.queryByRole('button', { name: 'すべて既読' })).not.toBeInTheDocument();
  });

  it('hides read-all when the list is empty despite a positive summary count', async () => {
    mocks.list.mockResolvedValue({ threads: [], unreadElsewhere: [] });
    renderInbox(true, true);
    await screen.findByText('お問い合わせはありません');
    expect(screen.queryByRole('button', { name: 'すべて既読' })).not.toBeInTheDocument();
  });

  it('sends displayed and unlisted unread threads once per id, then refetches summary and list', async () => {
    const latest = { ...detail.thread, id: 'latest', lastMessageAt: '2026-10-09T01:43:00.000Z' };
    const oldest = { ...detail.thread, id: 'oldest', lastMessageAt: '2026-10-09T01:41:00.000Z' };
    const duplicate = { id: thread.id, lastMessageAt: elsewhere.lastMessageAt };
    mocks.list.mockResolvedValue({ threads: [latest, thread, oldest], unreadElsewhere: [elsewhere, duplicate] });
    mocks.summary.mockResolvedValue({ isReceiver: true, unreadCount: 2 });
    const view = renderInbox();
    const summary = renderHook(() => useKioskInquirySummary('device', true), {
      wrapper: ({ children }) => <QueryClientProvider client={view.queryClient}>{children}</QueryClientProvider>
    });
    await waitFor(() => expect(summary.result.current.isFetching).toBe(false));
    expect(mocks.summary).toHaveBeenCalledTimes(1);
    view.touch();
    const button = await screen.findByRole('button', { name: 'すべて既読' });
    expect(button.nextElementSibling).toBe(screen.getByRole('button', { name: '＋ 新規' }));
    let unreadCountAtRefetch: number | undefined;
    mocks.readAll.mockImplementationOnce(async () => {
      mocks.list.mockResolvedValue({ threads: [latest, detail.thread, oldest], unreadElsewhere: [] });
      mocks.summary.mockImplementationOnce(() => {
        unreadCountAtRefetch = view.queryClient
          .getQueryData<KioskInquirySummary>(kioskQueryKeys.inquirySummary('device'))?.unreadCount;
        return Promise.resolve({ isReceiver: true, unreadCount: 0 });
      });
      return { updatedCount: 2 };
    });
    fireEvent.click(button);

    await waitFor(() => expect(summary.result.current.data?.unreadCount).toBe(0));
    expect(mocks.summary).toHaveBeenCalledTimes(2);
    expect(unreadCountAtRefetch).toBe(0);
    expect(mocks.readAll).toHaveBeenCalledWith({
      threads: [{ id: thread.id, lastMessageAt: thread.lastMessageAt }, elsewhere]
    }, 'allowed', expect.any(AbortSignal));
    await waitFor(() => expect(button).not.toBeInTheDocument());
  });

  it('offers read-all for unreadElsewhere even when the displayed threads are read and the summary is zero', async () => {
    mocks.list.mockResolvedValueOnce({ threads: [detail.thread], unreadElsewhere: [elsewhere] })
      .mockResolvedValue({ threads: [detail.thread], unreadElsewhere: [] });
    renderInbox(true, true, 0);
    const button = await screen.findByRole('button', { name: 'すべて既読' });
    fireEvent.click(button);

    await waitFor(() => expect(mocks.readAll).toHaveBeenCalledWith({
      threads: [elsewhere]
    }, undefined, expect.any(AbortSignal)));
    await waitFor(() => expect(button).not.toBeInTheDocument());
  });

  it('preserves unreadElsewhere after opening a thread and returning to the list', async () => {
    mocks.list.mockResolvedValue({ threads: [thread], unreadElsewhere: [elsewhere] });
    const view = renderInbox();
    view.touch();
    const row = await screen.findByRole('button', { name: /加工キオスク/ });
    // Exercise the cached list while the open action's refetch is pending.
    mocks.list.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(row);
    fireEvent.click(await screen.findByRole('button', { name: '一覧へ戻る' }));
    fireEvent.click(await screen.findByRole('button', { name: 'すべて既読' }));

    await waitFor(() => expect(mocks.readAll).toHaveBeenCalledWith({
      threads: [elsewhere]
    }, 'allowed', expect.any(AbortSignal)));
  });

  it('shows an error and keeps the inbox open when read-all fails', async () => {
    mocks.readAll.mockRejectedValueOnce(new Error('network'));
    renderInbox(true, true);
    fireEvent.click(await screen.findByRole('button', { name: 'すべて既読' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('既読にできません');
    expect(screen.getByText('加工キオスク')).toBeInTheDocument();
  });

  it.each([
    [401, 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED'],
    [403, 'KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED']
  ])('relocks with a login prompt on read-all HTTP %s', async (status, errorCode) => {
    mocks.readAll.mockRejectedValueOnce({ isAxiosError: true, response: { status, data: { errorCode } } });
    renderInbox(true, true);
    fireEvent.click(await screen.findByRole('button', { name: 'すべて既読' }));

    expect(await screen.findByText('社員証をタッチ')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ログインし直してください');
    expect(screen.queryByText('加工キオスク')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'すべて既読' })).not.toBeInTheDocument();
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
    let resolve: (value: { threads: typeof thread[]; unreadElsewhere: typeof elsewhere[] }) => void = () => undefined;
    mocks.list.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = renderInbox();
    view.touch();
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    const signal = mocks.list.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ threads: [thread], unreadElsewhere: [] }));
    expect(view.queryClient.getQueriesData({ queryKey: ['kiosk-inquiries'] })).toEqual([]);
  });

  it('shows an empty inbox', async () => {
    mocks.list.mockResolvedValue({ threads: [], unreadElsewhere: [] });
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
