import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInquiryCompose } from './KioskInquiryCompose';

const mocks = vi.hoisted(() => ({ post: vi.fn(), loading: false }));
const employees = [
  { id: 'e1', displayName: '組立 一郎', department: '製造部', section: '組立課' },
  { id: 'e2', displayName: '機械 二郎', department: '製造部', section: '機械課' },
  { id: 'e3', displayName: '機械 三郎', department: '製造部', section: '機械課' },
  { id: 'e4', displayName: '無所属 四郎', department: ' ', section: null },
  { id: 'e5', displayName: '総務 五郎', department: '総務部', section: ' ' }
];
vi.mock('../../../api/client', () => ({ postKioskSupport: mocks.post }));
vi.mock('../../../api/hooks', () => ({
  useKioskEmployees: () => ({ data: mocks.loading ? undefined : employees, isLoading: mocks.loading })
}));
const renderCompose = () => {
  const onSent = vi.fn();
  const onBack = vi.fn();
  return { ...render(<MemoryRouter initialEntries={['/kiosk/borrow']}>
    <KioskInquiryCompose clientKey="device" onBack={onBack} onSent={onSent} />
  </MemoryRouter>), onSent, onBack };
};
const selectSender = () => fireEvent.click(screen.getByRole('button', { name: '機械 二郎' }));
const send = () => fireEvent.click(screen.getByRole('button', { name: '送信' }));
const openDetails = async () => {
  fireEvent.click(screen.getByText('日時・詳細'));
  await waitFor(() => expect(screen.getByLabelText('打合せ日')).not.toHaveValue(''));
};
const senderNames = () => within(screen.getByRole('group', { name: /送信者/ })).getAllByRole('button').map(button => button.textContent);

beforeEach(() => { mocks.loading = false; mocks.post.mockReset().mockResolvedValue({ requestId: 'req', threadId: 'new-thread' }); });

describe('KioskInquiryCompose', () => {
  it('defaults to machining section and cannot send before selecting a sender', () => {
    renderCompose();
    expect(screen.getByRole('button', { name: '機械課' })).toHaveAttribute('aria-pressed', 'true');
    expect(senderNames()).toEqual(['機械 二郎', '機械 三郎']);
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('clears the sender on department changes', () => {
    renderCompose();
    selectSender();
    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '組立課' }));
    expect(senderNames()).toEqual(['組立 一郎']);
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '機械課' }));
    expect(screen.getByRole('button', { name: '機械 二郎' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('falls back from empty section to department, then 部署なし', () => {
    renderCompose();
    fireEvent.click(screen.getByRole('button', { name: '総務部' }));
    expect(senderNames()).toEqual(['総務 五郎']);
    fireEvent.click(screen.getByRole('button', { name: '部署なし' }));
    expect(senderNames()).toEqual(['無所属 四郎']);
  });

  it('shows employee loading state', () => {
    mocks.loading = true;
    renderCompose();
    expect(screen.getByRole('status')).toHaveTextContent('読込中…');
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });

  it('sends the original body format and pathname without optional fields', async () => {
    const view = renderCompose();
    selectSender();
    send();
    await waitFor(() => expect(view.onSent).toHaveBeenCalledWith('new-thread'));
    expect(mocks.post).toHaveBeenCalledWith({ message: '送信者: 機械 二郎\n依頼内容: 現場まで来てください。', page: '/kiosk/borrow' }, 'device');
  });

  it('initializes the current local date on expansion and sends date, time and trimmed details', async () => {
    const now = new Date(2026, 9, 13, 14, 25);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    renderCompose();
    fireEvent.click(screen.getByText('日時・詳細'));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    vi.useRealTimers();
    expect(screen.getByLabelText('打合せ日')).toHaveValue('2026-10-13');
    expect(screen.getByLabelText('打合せ時刻')).toHaveValue('14:25');
    fireEvent.change(screen.getByLabelText('打合せ日'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByLabelText('打合せ時刻'), { target: { value: '09:30' } });
    expect(screen.getByLabelText('詳細')).toHaveAttribute('maxlength', '500');
    fireEvent.change(screen.getByLabelText('詳細'), { target: { value: '  設備の確認  ' } });
    selectSender();
    send();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({
      message: '送信者: 機械 二郎\n依頼内容: 現場まで来てください。\n打合せ日時: 2026-10-14 09:30\n詳細: 設備の確認', page: '/kiosk/borrow'
    }, 'device'));
  });

  it('omits the date after collapsing details again', async () => {
    renderCompose();
    await openDetails();
    fireEvent.click(screen.getByText('日時・詳細'));
    selectSender();
    send();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({ message: '送信者: 機械 二郎\n依頼内容: 現場まで来てください。', page: '/kiosk/borrow' }, 'device'));
  });

  it.each([
    [new Error('offline'), '送信できません'],
    [{ isAxiosError: true, response: { status: 429 } }, '少し待ってから送ってください']
  ])('keeps the form and sender after failure (%s)', async (failure, message) => {
    mocks.post.mockRejectedValueOnce(failure);
    const view = renderCompose();
    selectSender();
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '機械 二郎' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled();
    expect(view.onSent).not.toHaveBeenCalled();
  });

  it('prevents duplicate submission and ignores completion after unmount', async () => {
    let resolve!: (value: { threadId: string }) => void;
    mocks.post.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = renderCompose();
    selectSender();
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.submit(screen.getByRole('form'));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '送信中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '一覧へ戻る' })).toBeDisabled();
    view.unmount();
    await act(async () => resolve({ threadId: 'new-thread' }));
    expect(view.onSent).not.toHaveBeenCalled();
  });

  it('returns without sending', () => {
    const view = renderCompose();
    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }));
    expect(view.onBack).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
