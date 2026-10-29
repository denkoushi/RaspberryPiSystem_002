import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCheckSheetFixture, makeStamp } from './checkSheet.fixture';
import { CheckSheetScreen } from './CheckSheetScreen';

import type { AssemblyCheckSheetPayload, AssemblyCheckSheetStampInput } from '@raspi-system/shared-types';
const mocks = vi.hoisted(() => ({
  nfc: null as { uid: string; timestamp: number } | null,
  get: vi.fn(), stamp: vi.fn(), skip: vi.fn(), transition: vi.fn()
}));
vi.mock('../../../hooks/useNfcStream', () => ({ useNfcStream: (enabled: boolean) => enabled ? mocks.nfc : null }));
vi.mock('../../../api/domains/assembly/check-sheets', () => ({
  getAssemblyCheckSheet: mocks.get, stampAssemblyCheckSheet: mocks.stamp,
  skipAssemblyCheckSheetCondition: mocks.skip, transitionAssemblyCheckSheet: mocks.transition
}));
let fixture: AssemblyCheckSheetPayload;
beforeEach(() => {
  vi.clearAllMocks(); mocks.nfc = null;
  fixture = makeCheckSheetFixture();
  mocks.get.mockImplementation(async () => structuredClone(fixture));
  mocks.stamp.mockImplementation(async (_id: string, input: AssemblyCheckSheetStampInput) => ({ ...structuredClone(fixture),
    stamps: [...fixture.stamps.filter((stamp) => stamp.itemId !== input.itemId), { ...makeStamp(input.itemId), ...input }] }));
});
function mount() {
  return render(<MemoryRouter><CheckSheetScreen sheetId="sheet" /></MemoryRouter>);
}
function scan(view: ReturnType<typeof mount>, timestamp = 1) {
  mocks.nfc = { uid: 'tag', timestamp };
  view.rerender(<MemoryRouter><CheckSheetScreen sheetId="sheet" /></MemoryRouter>);
}
describe('check-sheet screen', () => {
  it('renders the approved mock map, active card, flag, disabled paper button and fixed scale', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
    const view = mount();
    await screen.findByRole('heading', { name: 'ドライバー入力電圧確認' });
    expect(within(screen.getByRole('navigation', { name: 'シート全体' })).getAllByRole('button')).toHaveLength(fixture.revision.items.length);
    expect(view.container.querySelectorAll('.mrow')).toHaveLength(22);
    expect(screen.getByRole('button', { name: '紙の控え' })).toBeDisabled();
    expect(screen.queryByText('試し：タグ')).not.toBeInTheDocument();
    expect(view.container.querySelector('.app')).toHaveStyle({ transform: 'translate(-50%, -50%) scale(1)' });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    fireEvent(window, new Event('resize'));
    expect(view.container.querySelector('.app')).toHaveStyle({ transform: `translate(-50%, -50%) scale(${2 / 3})` });
    expect(document.body.style.overflow).toBe('hidden');
  });
  it('submits numeric values on NFC once and shows a vermilion name/time seal before advancing', async () => {
    const view = mount();
    fireEvent.change(await screen.findByRole('textbox', { name: '電圧 V' }), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK', exact: true }));
    scan(view);
    await waitFor(() => expect(mocks.stamp).toHaveBeenCalledTimes(1));
    expect(mocks.stamp).toHaveBeenCalledWith('sheet', expect.objectContaining({ itemId: '6-3', values: { value0: 24 }, result: 'OK', nfcTagUid: 'tag' }));
    await waitFor(() => expect(view.container.querySelector('.seal .nm')).toHaveTextContent('山田'));
    expect(view.container.querySelector('.seal .tm')).toHaveTextContent('09:12');
    await screen.findByRole('heading', { name: 'センサーとドグが干渉なく感知するか' });
    expect(mocks.stamp).toHaveBeenCalledTimes(1);
  });
  it.each(['班長のタグが必要です', '社員タグが見つかりません'])('shows short NFC error toast: %s', async (message) => {
    mocks.stamp.mockRejectedValue({ response: { data: { message, errorCode: 'CHECK_SHEET_ROLE_REQUIRED' } } });
    const view = mount();
    await screen.findByRole('heading', { name: 'ドライバー入力電圧確認' });
    fireEvent.click(screen.getByRole('button', { name: '1-1', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'OK', exact: true }));
    scan(view);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
  it('adds NG to the flag list after choosing flag and scanning', async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'NG', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: '問題点' }), { target: { value: '電圧が異なる' } });
    fireEvent.click(screen.getByRole('button', { name: '目印を付けて次へ' }));
    expect(mocks.stamp).not.toHaveBeenCalled();
    scan(view);
    await waitFor(() => expect(view.container.querySelectorAll('.mk')).toHaveLength(2));
    expect(mocks.stamp).toHaveBeenCalledWith('sheet', expect.objectContaining({ result: 'NG', flagged: true, ngReason: '電圧が異なる' }));
    expect(screen.getByRole('button', { name: '完了', exact: true })).toBeDisabled();
  });
  it('sends a single conditional NA request and requires resume for a paused sheet', async () => {
    fixture.status = 'PAUSED';
    mocks.transition.mockResolvedValue({ ...fixture, status: 'IN_PROGRESS' });
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '再開' }));
    expect(mocks.transition).not.toHaveBeenCalled();
    scan(view);
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledWith('sheet', 'resume', 'tag'));
    await waitFor(() => expect(screen.queryByText('中断中')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '7-2', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '該当なし', exact: true }));
    mocks.skip.mockResolvedValue({ ...fixture, status: 'IN_PROGRESS' });
    scan(view, 2);
    await waitFor(() => expect(mocks.skip).toHaveBeenCalledWith('sheet', 'motor', 'tag'));
  });
  it.each(['pause', 'complete'] as const)('waits for a fresh tag before %s and never sends a stamp', async (action) => {
    fixture.stamps = fixture.revision.items.map((item) => makeStamp(item.id));
    mocks.transition.mockResolvedValue({ ...fixture, status: action === 'pause' ? 'PAUSED' : 'COMPLETED' });
    const view = mount();
    await screen.findByText('全項目に印が揃いました');
    scan(view);
    fireEvent.click(screen.getByRole('button', { name: action === 'pause' ? '中断' : '完了', exact: true }));
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('社員タグをかざす');
    expect(mocks.transition).not.toHaveBeenCalled();
    scan(view, 2);
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledExactlyOnceWith('sheet', action, 'tag'));
    expect(mocks.stamp).not.toHaveBeenCalled();
  });
  it('can cancel completion or retry with another tag after an error', async () => {
    fixture.stamps = fixture.revision.items.map((item) => makeStamp(item.id));
    mocks.transition.mockRejectedValueOnce({ response: { data: { message: '社員タグが見つかりません' } } })
      .mockResolvedValueOnce({ ...fixture, status: 'COMPLETED' });
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: '完了', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    scan(view);
    expect(mocks.transition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '完了', exact: true }));
    scan(view, 2);
    expect(await screen.findByRole('alert')).toHaveTextContent('社員タグが見つかりません');
    scan(view, 3);
    await screen.findByRole('button', { name: '完了済み' });
    expect(mocks.transition).toHaveBeenCalledTimes(2);
  });
  it('does not retroactively use a scan that arrived before input was ready', async () => {
    const view = mount();
    await screen.findByRole('heading', { name: 'ドライバー入力電圧確認' });
    scan(view);
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox', { name: '電圧 V' }), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK', exact: true }));
    await act(async () => {});
    expect(mocks.stamp).not.toHaveBeenCalled();
  });
});
