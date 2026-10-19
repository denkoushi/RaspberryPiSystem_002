import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as tagDeskApi from '../../api/domains/tag-desk';

import { KioskTagDeskPage } from './KioskTagDeskPage';

import type { NfcEvent } from '../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null, listeners: new Set<() => void>() }));

vi.mock('../../hooks/useNfcStream', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useNfcStream: (enabled: boolean) => {
      const [event, setEvent] = useState<NfcEvent | null>(nfc.event);
      useEffect(() => {
        const update = () => setEvent(nfc.event);
        nfc.listeners.add(update);
        return () => void nfc.listeners.delete(update);
      }, []);
      return enabled ? event : null;
    }
  };
});

vi.mock('../../api/domains/tag-desk', () => ({
  verifyTagDeskPin: vi.fn(),
  getTagDeskRegistry: vi.fn(),
  getTagDeskOptions: vi.fn(),
  getTagDeskPositionRanks: vi.fn(),
  saveTagDeskPositionRanks: vi.fn(),
  getTagDeskEvents: vi.fn(),
  resolveTagDeskUid: vi.fn(),
  linkTagDeskTag: vi.fn(),
  unlinkTagDeskTag: vi.fn(),
  saveTagDeskRecord: vi.fn(),
  deleteTagDeskRecord: vi.fn()
}));

const api = vi.mocked(tagDeskApi);

const employees: tagDeskApi.TagDeskRow[] = [
  { kind: 'employee', id: 'emp-1', code: '7024', name: '山本 健太', sub: '製造部', sub2: '組立課', status: 'ACTIVE', tags: [{ bindingId: 'emp-1', uid: '04A1B2C3D45E80' }], record: {} },
  { kind: 'employee', id: 'emp-2', code: '7033', name: '岡本 由香', sub: '管理部', sub2: null, status: 'ACTIVE', tags: [], record: {} }
];

function scan(uid: string, eventId: number) {
  act(() => {
    nfc.event = { uid, timestamp: new Date().toISOString(), eventId };
    nfc.listeners.forEach((listener) => listener());
  });
}

async function unlock() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KioskTagDeskPage />
    </QueryClientProvider>
  );
  const pad = screen.getByLabelText('パスワードのテンキー');
  for (const digit of ['4', '8', '2', '1']) fireEvent.click(within(pad).getByRole('button', { name: digit }));
  await screen.findByRole('tab', { name: /社員/ });
  await screen.findByText('山本 健太');
}

describe('KioskTagDeskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no canvas; the reader's field lines simply do not draw.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    nfc.event = null;
    nfc.listeners.clear();
    api.verifyTagDeskPin.mockResolvedValue({ success: true });
    api.getTagDeskRegistry.mockResolvedValue(employees);
    api.getTagDeskPositionRanks.mockResolvedValue({ ranks: [], unmappedPositions: [{ positionName: '班長', employeeCount: 1 }] });
    api.saveTagDeskPositionRanks.mockResolvedValue(undefined);
    api.getTagDeskOptions.mockResolvedValue({ divisions: [], sections: [], departments: [], genres: [], positions: [] });
    api.getTagDeskEvents.mockResolvedValue([]);
    api.unlinkTagDeskTag.mockResolvedValue(undefined);
    api.linkTagDeskTag.mockResolvedValue([]);
  });

  it('stays locked until the 4-digit password is accepted', async () => {
    api.verifyTagDeskPin.mockResolvedValueOnce({ success: false });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <KioskTagDeskPage />
      </QueryClientProvider>
    );
    const pad = screen.getByLabelText('パスワードのテンキー');
    for (const digit of ['1', '1', '1', '1']) fireEvent.click(within(pad).getByRole('button', { name: digit }));
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワードが違います');
    expect(api.getTagDeskRegistry).not.toHaveBeenCalled();
  });

  it('shows employee position chips and counts approvers across all rows, and hides them on asset tabs', async () => {
    api.getTagDeskRegistry.mockResolvedValue([
      { ...employees[0], positionName: '班長', positionApproval: 'approver' },
      { ...employees[1], positionName: '一般', positionApproval: 'none' },
      { ...employees[1], id: 'emp-3', name: '未対応 社員', positionName: '主事', positionApproval: 'unmapped' },
      { ...employees[1], id: 'emp-4', name: '未設定 社員', positionName: null, positionApproval: null }
    ]);
    await unlock();
    const registry = screen.getByRole('region', { name: '紐づけ先の一覧' });
    expect(within(registry).getByText('職位')).toBeInTheDocument();
    expect(within(registry).getByRole('button', { name: '職位の対応表' })).toBeInTheDocument();
    const approver = within(registry).getByRole('button', { name: /山本 健太/ });
    expect(within(approver).getByText('班長')).toBeInTheDocument();
    expect(within(approver).getByText('承認可')).toHaveClass('text-[#34d399]');
    expect(within(approver).getByText('承認可').querySelector('svg')).not.toBeNull();
    const general = within(registry).getByRole('button', { name: /岡本 由香/ });
    expect(within(general).getByText('一般')).toBeInTheDocument();
    expect(within(general).queryByText(/承認/)).not.toBeInTheDocument();
    expect(within(registry).getByText('対応表なし')).toHaveClass('text-[#ffb547]');
    expect(within(registry).getByText('未設定')).toHaveClass('text-[#5c6d83]');
    expect(within(registry).getByText('承認可 1人')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('名前・コードで探す'), { target: { value: '未設定' } });
    expect(within(registry).getByText('承認可 1人')).toBeInTheDocument();
    api.getTagDeskRegistry.mockResolvedValue([]);
    for (const tab of ['工具', '計測機器', '吊具']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(within(registry).queryByText('職位')).not.toBeInTheDocument();
      expect(within(registry).queryByRole('button', { name: '職位の対応表' })).not.toBeInTheDocument();
      expect(within(registry).queryByText(/承認可/)).not.toBeInTheDocument();
    }
  });

  it('opens the ladder without re-entering the PIN and refreshes registry and options after saving', async () => {
    api.getTagDeskRegistry.mockResolvedValue([{ ...employees[0], positionName: '班長', positionApproval: 'unmapped' }]);
    await unlock();
    const optionsBefore = api.getTagDeskOptions.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '職位の対応表' }));
    const chip = await screen.findByRole('button', { name: '班長 1人' });
    expect(api.getTagDeskPositionRanks).toHaveBeenCalledWith('4821');
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: '部長相当に置く' }));
    api.getTagDeskRegistry.mockResolvedValue([{ ...employees[0], positionName: '班長', positionApproval: 'approver' }]);
    api.getTagDeskOptions.mockResolvedValue({ divisions: [], sections: [], departments: [], genres: [], positions: [{ name: '班長', approval: 'approver' }] });
    fireEvent.click(screen.getByRole('button', { name: '保存（1件）' }));
    await screen.findByText('保存しました');
    expect(api.saveTagDeskPositionRanks).toHaveBeenCalledWith('4821', { ranks: [{ positionName: '班長', rank: 'general_manager' }] });
    expect(api.getTagDeskOptions.mock.calls.length).toBeGreaterThan(optionsBefore);
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    const registry = await screen.findByRole('region', { name: '紐づけ先の一覧' });
    expect(within(registry).getByText('承認可')).toBeInTheDocument();
    expect(within(registry).queryByText('対応表なし')).not.toBeInTheDocument();
    expect(api.verifyTagDeskPin).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '社員を追加' }));
    fireEvent.change(screen.getByRole('combobox', { name: '職位' }), { target: { value: '班長' } });
    expect(screen.getByRole('combobox', { name: '職位' })).toHaveValue('班長');
    expect(screen.getAllByText('承認可')).toHaveLength(2);
  });

  it('shows where a read tag is bound and releases it only after the second press', async () => {
    api.resolveTagDeskUid.mockResolvedValue([
      { kind: 'employee', bindingId: 'emp-1', targetId: 'emp-1', code: '7024', name: '山本 健太', sub: '製造部', sub2: '組立課', status: 'ACTIVE', activeLoans: 0, recent: [] }
    ]);
    await unlock();
    expect(screen.getByText('部門')).toBeInTheDocument();
    expect(screen.getByText('部署')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /山本 健太/ });
    expect(within(row).getByText('製造部')).toBeInTheDocument();
    expect(within(row).getByText('組立課')).toBeInTheDocument();
    scan('04A1B2C3D45E80', 1);

    const dock = screen.getByRole('region', { name: '読み取ったタグ' });
    await within(dock).findByText('山本 健太');
    expect(within(dock).getByText('製造部 組立課')).toBeInTheDocument();
    expect(api.resolveTagDeskUid).toHaveBeenCalledWith('4821', '04A1B2C3D45E80');

    fireEvent.click(within(dock).getByRole('button', { name: '外す' }));
    expect(api.unlinkTagDeskTag).not.toHaveBeenCalled();
    expect(within(dock).getByText('山本 健太 から外しますか？')).toBeInTheDocument();

    api.resolveTagDeskUid.mockResolvedValue([]);
    fireEvent.click(within(dock).getByRole('button', { name: '外す' }));
    await waitFor(() => expect(api.unlinkTagDeskTag).toHaveBeenCalledWith('4821', { kind: 'employee', bindingId: 'emp-1' }));
    expect(await within(dock).findByText('山本 健太 から外しました')).toBeInTheDocument();
  });

  it('binds a free tag to the row picked in the list', async () => {
    api.resolveTagDeskUid.mockResolvedValue([]);
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: /岡本 由香/ }));
    expect(within(screen.getByRole('region', { name: '読み取ったタグ' })).getByText('管理部')).toBeInTheDocument();
    scan('04FFEE00112233', 2);

    const dock = screen.getByRole('region', { name: '読み取ったタグ' });
    const bind = await within(dock).findByRole('button', { name: /岡本 由香 に付ける/ });
    fireEvent.click(bind);
    await waitFor(() =>
      expect(api.linkTagDeskTag).toHaveBeenCalledWith('4821', { kind: 'employee', targetId: 'emp-2', uid: '04FFEE00112233', replace: false })
    );
  });
});
