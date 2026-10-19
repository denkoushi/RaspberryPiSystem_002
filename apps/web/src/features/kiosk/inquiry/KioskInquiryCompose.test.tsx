import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskInquiryCompose } from './KioskInquiryCompose';

const mocks = vi.hoisted(() => ({ post: vi.fn(), loading: false }));
const employees = [
  { id: 'e1', displayName: '組立 一郎', department: '製造部', section: '組立課' },
  { id: 'e2', displayName: '機械 二郎', department: '製造部', section: '機械課' },
  { id: 'e3', displayName: '機械 三郎', department: '製造部', section: '機械課' },
  { id: 'e4', displayName: '無所属 四郎', department: ' ', section: null },
  { id: 'e5', displayName: '総務 五郎', department: '総務部', section: ' ' }
];
let employeeData = employees;
vi.mock('../../../api/client', () => ({ postKioskSupport: mocks.post }));
vi.mock('../../../api/hooks', () => ({
  useKioskEmployees: () => ({ data: mocks.loading ? undefined : employeeData, isLoading: mocks.loading })
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

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(() => { localStorage.clear(); employeeData = employees; mocks.loading = false; mocks.post.mockReset().mockResolvedValue({ requestId: 'req', threadId: 'new-thread' }); });

describe('KioskInquiryCompose', () => {
  it('defaults to machining section and cannot send before selecting a sender', () => {
    renderCompose();
    expect(screen.getByRole('button', { name: '機械課' })).toHaveAttribute('aria-pressed', 'true');
    expect(senderNames()).toEqual(['機械 三郎', '機械 二郎']);
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

  it('hides the other senders once one is chosen and shows them again when it is pressed again', () => {
    renderCompose();
    selectSender();
    expect(senderNames()).toEqual(['機械 二郎']);
    expect(screen.getByRole('button', { name: '機械 二郎' })).toHaveAttribute('aria-pressed', 'true');
    selectSender();
    expect(senderNames()).toEqual(['機械 三郎', '機械 二郎']);
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
  });

  it('falls back from empty section to department, then 部署なし', () => {
    renderCompose();
    fireEvent.click(screen.getByRole('button', { name: '他の部署' }));
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


describe('compose department choices and request history', () => {
  const historyKey = 'kiosk.inquiry.request-history';
  const setRequest = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: '依頼' }), { target: { value } });
  const historyButton = () => screen.getByRole('button', { name: '過去の依頼' });
  const departments = () => within(screen.getByRole('group', { name: '部署' })).getAllByRole('button').map(button => button.textContent);

  it('shows four primary departments in order and toggles others, keeping the selected other department visible', () => {
    employeeData = ['総務部', '第二組立２課', '本社製造課', '第一組立１課', '本社機械課', '管理部'].map((section, index) => ({
      id: `d${index}`, displayName: `社員${index}`, department: '製造部', section
    }));
    renderCompose();
    expect(departments()).toEqual(['本社機械課', '本社製造課', '第一組立１課', '第二組立２課', '⋯']);
    const toggle = screen.getByRole('button', { name: '他の部署' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '管理部' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '総務部' }));
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: '管理部' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '総務部' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '本社機械課' }));
    expect(screen.queryByRole('button', { name: '総務部' })).not.toBeInTheDocument();
  });

  it('shows every department without a toggle when none are primary', () => {
    employeeData = employees.slice(3);
    renderCompose();
    expect(departments()).toEqual(['総務部', '部署なし']);
    expect(screen.queryByRole('button', { name: '他の部署' })).not.toBeInTheDocument();
  });

  it('renders saved sender order and appends new employees in name order', () => {
    localStorage.setItem('kiosk.inquiry.sender-order:機械課', JSON.stringify(['missing', 'e2']));
    renderCompose();
    expect(senderNames()).toEqual(['機械 二郎', '機械 三郎']);
    fireEvent.keyDown(screen.getByRole('button', { name: '機械 二郎' }), { altKey: true, key: 'ArrowRight' });
    expect(senderNames()).toEqual(['機械 三郎', '機械 二郎']);
    expect(JSON.parse(localStorage.getItem('kiosk.inquiry.sender-order:機械課')!)).toEqual(['e3', 'e2']);
  });

  it('sends a freely edited request and saves trimmed history only after success', async () => {
    let resolve!: (value: { threadId: string }) => void;
    mocks.post.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = renderCompose();
    selectSender();
    expect(screen.getByRole('textbox', { name: '依頼' })).toHaveAttribute('maxlength', '200');
    setRequest('  工具を持って来てください。  ');
    send();
    expect(mocks.post).toHaveBeenCalledWith({ message: '送信者: 機械 二郎\n依頼内容: 工具を持って来てください。', page: '/kiosk/borrow' }, 'device');
    expect(localStorage.getItem(historyKey)).toBeNull();
    await act(async () => resolve({ threadId: 'new-thread' }));
    expect(view.onSent).toHaveBeenCalledWith('new-thread');
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toEqual(['工具を持って来てください。']);
  });

  it('does not send an empty or whitespace-only request', () => {
    renderCompose();
    selectSender();
    for (const request of ['', '   ']) {
      setRequest(request);
      expect(screen.getByRole('button', { name: '送信' })).toBeDisabled();
      fireEvent.submit(screen.getByRole('form'));
    }
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('prevents implicit Enter submission including IME confirmation', () => {
    renderCompose();
    selectSender();
    const input = screen.getByRole('textbox', { name: '依頼' });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })).toBe(false);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('keeps request and existing history unchanged after failure', async () => {
    localStorage.setItem(historyKey, JSON.stringify(['以前の依頼']));
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    renderCompose();
    selectSender();
    setRequest('新しい依頼');
    send();
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '依頼' })).toHaveValue('新しい依頼');
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toEqual(['以前の依頼']);
  });

  it('promotes duplicates, caps saved history at ten and selects history with the default always first', async () => {
    const initial = Array.from({ length: 10 }, (_, i) => `依頼${i}`);
    localStorage.setItem(historyKey, JSON.stringify(initial));
    renderCompose();
    selectSender();
    setRequest('  依頼5  ');
    send();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(historyKey)!)[0]).toBe('依頼5'));
    expect(JSON.parse(localStorage.getItem(historyKey)!)).toEqual(['依頼5', ...initial.filter(entry => entry !== '依頼5')]);
    await waitFor(() => expect(screen.getByRole('button', { name: '送信' })).toBeEnabled());
    setRequest('最新の依頼');
    send();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(historyKey)!)).toEqual(['最新の依頼', '依頼5', ...initial.filter(entry => entry !== '依頼5').slice(0, 8)]));
    await waitFor(() => expect(historyButton()).toBeEnabled());
    fireEvent.click(historyButton());
    expect(historyButton()).toHaveAttribute('aria-expanded', 'true');
    const buttons = within(screen.getByRole('list', { name: '依頼履歴' })).getAllByRole('button');
    expect(buttons.slice(0, 3).map(button => button.textContent)).toEqual(['現場まで来てください。', '最新の依頼', '依頼5']);
    fireEvent.click(screen.getByRole('button', { name: '依頼5' }));
    expect(screen.getByRole('textbox', { name: '依頼' })).toHaveValue('依頼5');
    expect(historyButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: '依頼履歴' })).not.toBeInTheDocument();
  });

  it.each(['broken', '{}', '[1]', '[]'])('keeps the default available for invalid or empty history (%s)', value => {
    localStorage.setItem(historyKey, value);
    renderCompose();
    fireEvent.click(historyButton());
    expect(within(screen.getByRole('list', { name: '依頼履歴' })).getAllByRole('button').map(button => button.textContent)).toEqual(['現場まで来てください。']);
  });

  it('can send and use session history despite storage read/write exceptions', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const view = renderCompose();
    selectSender();
    setRequest('保存不可でも送信');
    send();
    await waitFor(() => expect(view.onSent).toHaveBeenCalled());
    fireEvent.click(historyButton());
    fireEvent.click(screen.getByRole('button', { name: '保存不可でも送信' }));
    expect(screen.getByRole('textbox', { name: '依頼' })).toHaveValue('保存不可でも送信');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
