import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlaylist } from './playlistModel';
import { PlaylistPanel } from './PlaylistPanel';

import type { SignageSchedule } from '../../../api/client';

const update = vi.fn().mockResolvedValue({});
const remove = vi.fn().mockResolvedValue({});
const confirm = vi.fn().mockResolvedValue(true);

vi.mock('../../../api/hooks', () => ({
  useSignageScheduleMutations: () => ({
    update: { mutateAsync: update, isPending: false },
    remove: { mutateAsync: remove, isPending: false },
  }),
}));
vi.mock('../../../contexts/ConfirmContext', () => ({ useConfirm: () => confirm }));

const schedule = (partial: Partial<SignageSchedule>): SignageSchedule => ({
  id: 's1',
  name: '自主検査KPI',
  contentType: 'TOOLS',
  pdfId: null,
  layoutConfig: null,
  targetClientKeys: [],
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00',
  endTime: '23:59',
  priority: 0,
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...partial,
});

function renderPanel(schedules: SignageSchedule[], onAdvanced = vi.fn()) {
  const items = buildPlaylist(schedules, 'key-a', { scheduleIds: schedules.map((s) => s.id), currentIndex: 0, secondsUntilSwitch: 10, isFallback: false });
  render(
    <PlaylistPanel
      items={items}
      schedules={schedules}
      clientKey="key-a"
      clientName="現場 Pi3"
      switchSeconds={30}
      justAddedId={null}
      onAdd={vi.fn()}
      onAdvanced={onAdvanced}
    />,
  );
  return { onAdvanced };
}

describe('PlaylistPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
  });

  it('shows each item with when it plays and what is on air', () => {
    renderPanel([schedule({}), schedule({ id: 's2', name: '持出一覧', dayOfWeek: [1, 2, 3, 4, 5], startTime: '07:30', endTime: '09:00' })]);
    expect(screen.getByText('2 件 · 30秒ずつ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /自主検査KPI.*いま映っています.*いつも/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /持出一覧.*平日 7:30–9:00/ })).toBeInTheDocument();
  });

  it('limits an always-on item to a time window from the row itself', async () => {
    renderPanel([schedule({})]);
    fireEvent.click(screen.getByRole('button', { name: /自主検査KPI.*いつも/ }));
    fireEvent.click(screen.getByRole('button', { name: '時間を決める' }));
    fireEvent.change(screen.getByLabelText('始まりの時刻'), { target: { value: '13:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: 's1', payload: { dayOfWeek: [1, 2, 3, 4, 5], startTime: '13:00', endTime: '17:00' } }),
    );
  });

  it('refuses a time window without days and does not save', () => {
    renderPanel([schedule({})]);
    fireEvent.click(screen.getByRole('button', { name: /自主検査KPI.*いつも/ }));
    fireEvent.click(screen.getByRole('button', { name: '時間を決める' }));
    for (const day of ['月曜', '火曜', '水曜', '木曜', '金曜']) fireEvent.click(screen.getByRole('button', { name: day }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByRole('alert')).toHaveTextContent('曜日を 1 つ以上選んでください');
    expect(update).not.toHaveBeenCalled();
  });

  it('deletes an all-screens item after warning that every screen is affected', async () => {
    renderPanel([schedule({})]);
    fireEvent.click(screen.getByRole('button', { name: '自主検査KPI を外す' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('すべての画面から外れます') }));
  });

  it('only drops this screen when the item is also shown elsewhere, and does nothing when cancelled', async () => {
    renderPanel([schedule({ targetClientKeys: ['key-a', 'key-b'] })]);
    fireEvent.click(screen.getByRole('button', { name: '自主検査KPI を外す' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', payload: { targetClientKeys: ['key-b'] } }));
    expect(remove).not.toHaveBeenCalled();

    vi.clearAllMocks();
    confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: '自主検査KPI を外す' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });

  it('opens the detailed settings for the chosen item', () => {
    const { onAdvanced } = renderPanel([schedule({})]);
    fireEvent.click(screen.getByRole('button', { name: /自主検査KPI.*いつも/ }));
    fireEvent.click(screen.getByRole('button', { name: '詳しく' }));
    expect(onAdvanced).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });
});
