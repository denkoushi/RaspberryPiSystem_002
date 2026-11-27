import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DScheduleMinutesContext } from '../productionSchedule/DScheduleMinutesContext';
import { normalizeMachineName } from '../productionSchedule/machineName';

import { PlanningBoardSeibanDrawer } from './PlanningBoardSeibanDrawer';

import type { PlanningBoardSeibanDrawerProps } from './PlanningBoardSeibanDrawer';

vi.mock('../productionSchedule/machineName', async (original) => {
  const actual = await original<typeof import('../productionSchedule/machineName')>();
  return { ...actual, normalizeMachineName: vi.fn(actual.normalizeMachineName) };
});

const props = (): PlanningBoardSeibanDrawerProps => ({
  isOpen: true,
  registeredFseibans: Array.from({ length: 244 }, (_, index) => `26-${1000 + index}`),
  selectedFseibans: new Set(),
  machineNameBySeiban: new Map([['26-1000', '研削盤']]),
  onClose: vi.fn(), onRegister: vi.fn(), onRegisterMany: vi.fn(),
  onToggle: vi.fn(), onOpenDueDetail: vi.fn(), onClear: vi.fn(), onMove: vi.fn(),
  showCompletedCandidates: false, onShowCompletedCandidatesChange: vi.fn()
});

const rows = () => within(screen.getByRole('list', { name: '登録製番' })).getAllByRole('listitem');

describe('PlanningBoardSeibanDrawer registered list', () => {
  it('reuses all registered rows during search and callback changes, and dispatches the latest callbacks', () => {
    const values = props();
    const view = render(<PlanningBoardSeibanDrawer {...values} />);
    const originalRows = rows();
    expect(originalRows).toHaveLength(244);
    vi.mocked(normalizeMachineName).mockClear();
    fireEvent.change(screen.getByRole('searchbox', { name: '製番を検索' }), { target: { value: '2' } });
    const onToggle = vi.fn();
    const onMove = vi.fn();
    view.rerender(<PlanningBoardSeibanDrawer {...values} onToggle={onToggle} onMove={onMove} />);
    rows().forEach((row, index) => expect(row).toBe(originalRows[index]));
    // DOM identity alone also survives ordinary reconciliation; verify that row generation was skipped.
    expect(vi.mocked(normalizeMachineName).mock.calls.every(([value]) => value === '2')).toBe(true);
    fireEvent.click(within(originalRows[0]).getByRole('button', { pressed: false }));
    fireEvent.click(within(originalRows[0]).getByRole('button', { name: '製番26-1000を下へ' }));
    expect(onToggle).toHaveBeenCalledWith('26-1000');
    expect(onMove).toHaveBeenCalledWith('26-1000', 'down');
    expect(values.onToggle).not.toHaveBeenCalled();
    expect(values.onMove).not.toHaveBeenCalled();
  });

  it('keeps every row mounted with visibility containment and updates selection, names, order and disabled state', () => {
    const values = props();
    const view = render(<PlanningBoardSeibanDrawer {...values} />);
    rows().forEach((row) => expect(row).toHaveClass('[content-visibility:auto]', '[contain-intrinsic-size:auto_2.75rem]'));
    expect(within(rows()[0]).getByRole('button', { name: '製番26-1000を上へ' })).toBeDisabled();
    expect(within(rows()[243]).getByRole('button', { name: '製番26-1243を下へ' })).toBeDisabled();
    view.rerender(<PlanningBoardSeibanDrawer {...values}
      registeredFseibans={[...values.registeredFseibans].reverse()}
      selectedFseibans={new Set(['26-1243'])}
      machineNameBySeiban={new Map([['26-1243', '更新機種']])} />);
    expect(rows()).toHaveLength(244);
    expect(within(rows()[0]).getByRole('button', { pressed: true })).toHaveTextContent('26-1243');
    expect(rows()[0]).toHaveTextContent('更新機種');
    view.rerender(<PlanningBoardSeibanDrawer {...values} orderBusy />);
    rows().forEach((row) => within(row).getAllByRole('button').forEach((button) => expect(button).toBeDisabled()));
  });
});

describe('PlanningBoardSeibanDrawer minutes received dates', () => {
  it('shows JST received dates, a dash for none, and nothing without data', () => {
    const view = render(<PlanningBoardSeibanDrawer {...props()} />);
    expect(screen.queryByText('日程メール取得日')).toBeNull();
    view.unmount();
    render(
      <DScheduleMinutesContext.Provider value={{ dueSource: 'excel', rows: new Map(), latestReceivedAt: { D_COMPANY: '2026-11-25T23:42:00.000Z', INTERNAL: null } }}>
        <PlanningBoardSeibanDrawer {...props()} />
      </DScheduleMinutesContext.Provider>
    );
    expect(screen.getByText('日程メール取得日').parentElement?.textContent).toBe('日程メール取得日D社11/26(木) 8:42一般—');
  });
});
