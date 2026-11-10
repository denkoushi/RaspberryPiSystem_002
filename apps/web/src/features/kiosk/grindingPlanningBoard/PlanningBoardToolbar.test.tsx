import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardToolbar } from './PlanningBoardToolbar';

import type { PlanningBoardToolbarProps } from './PlanningBoardToolbar';

const props = (): PlanningBoardToolbarProps => ({
  ganttEnabled: true, onToggleGantt: vi.fn(), ganttMode: 'forward', onGanttModeChange: vi.fn(), lateCount: 2, onNextLate: vi.fn(),
  onProposeOrder: vi.fn(), onSortDue: vi.fn(), onUndoOrder: vi.fn(), canUndoOrder: true,
  category: 'grinding', view: 'resource', status: 'incomplete', allocation: 'alternate', selectedCount: 0, registeredCount: 3,
  onOpenDrawer: vi.fn(), onCategoryChange: vi.fn(), onViewChange: vi.fn(), onStatusChange: vi.fn(), onAllocationChange: vi.fn(), onOpenDueEditor: vi.fn()
});
describe('PlanningBoardToolbar forward controls', () => {
  it.each([false, true])('places SCAW after the Gantt group, toggles and hides it during comparison (gantt=%s)', (ganttEnabled) => {
    const onToggleScawMode = vi.fn();
    const values = { ...props(), ganttEnabled, onToggleScawMode };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const button = screen.getByRole('button', { name: 'SCAW' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.previousElementSibling).toContainElement(screen.getByRole('button', { name: 'ガント', exact: true }));
    fireEvent.click(button);
    expect(onToggleScawMode).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} scawEnabled />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const metrics = { lateCount: 2, waitMinutes: 120 };
    rerender(<PlanningBoardToolbar {...values} orderPreview={{ before: metrics, after: metrics }} />);
    expect(screen.queryByRole('button', { name: 'SCAW' })).not.toBeInTheDocument();
  });
  it('reserves the same toolbar height across Gantt and focus controls', () => {
    const values = props();
    const { container, rerender } = render(<PlanningBoardToolbar {...values} />);
    expect(container.firstElementChild).toHaveClass('h-[66px]');
    rerender(<PlanningBoardToolbar {...values} ganttEnabled={false} focusedSeiban="26-1041" />);
    expect(container.firstElementChild).toHaveClass('h-[66px]');
  });
  it.each([false, true])('keeps the icon-only scan control outside the Gantt group with gantt=%s', (ganttEnabled) => {
    render(<PlanningBoardToolbar {...props()} ganttEnabled={ganttEnabled} onOrderScan={() => null} />);
    const scan = screen.getByRole('button', { name: '移動票で製番を探す' });
    expect(scan).toHaveClass('h-[46px]', 'w-[46px]');
    expect(scan).toHaveTextContent('');
    expect(scan.querySelector('svg')).toBeInTheDocument();
    const gantt = screen.getByRole('button', { name: 'ガント', exact: true });
    expect(gantt.parentElement).not.toContainElement(scan);
    if (ganttEnabled) expect(scan.previousElementSibling?.previousElementSibling?.lastElementChild).toBe(screen.getByRole('button', { name: '製番ごとに色分け' }));
  });
  it.each([false, true])('shows the large-screen toggle at the far right with gantt=%s', (ganttEnabled) => {
    const onToggleLargeScreen = vi.fn();
    const values = { ...props(), ganttEnabled, onToggleLargeScreen };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const toggle = screen.getByRole('button', { name: '50インチ表示' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('ml-auto', 'h-[46px]', 'w-[46px]');
    expect(toggle.parentElement?.lastElementChild).toBe(toggle);
    fireEvent.click(toggle);
    expect(onToggleLargeScreen).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} largeScreen />);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-sky-400');
  });
  it('opens other scales, chooses one, and reflects the hidden selection', () => {
    const onGanttScaleChange = vi.fn();
    const values = { ...props(), ganttScale: 1 as const, onGanttScaleChange };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const trigger = screen.getByRole('button', { name: '他の幅' });
    expect(trigger).toHaveTextContent('⋯');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '1日' })).toBeVisible();
    expect(screen.getByRole('button', { name: '2日' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '1週' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: '他の幅' })).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '1週' }));
    expect(onGanttScaleChange).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('group', { name: '他の幅' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    rerender(<PlanningBoardToolbar {...values} ganttScale={7} />);
    expect(trigger).toHaveTextContent('1週 ▾');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveClass('bg-sky-400');
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: '4日' }));
    expect(screen.getByRole('group', { name: '他の幅' })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('shows the color toggle state and invokes its callback', () => {
    const onToggleColorBySeiban = vi.fn();
    const values = { ...props(), onToggleColorBySeiban };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const toggle = screen.getByRole('button', { name: '製番ごとに色分け' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleColorBySeiban).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} colorBySeiban />);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-sky-400');
  });
  it.each([
    ['工程', '研削', '切削・研削', 'onCategoryChange', [['cutting', '切削'], ['grinding', '研削'], ['all', '両方']]],
    ['区分', '一般・D社', '一般・D社', 'onScheduleSourceChange', [['general', '一般'], ['dCompany', 'D社'], ['both', '両方']]]
  ] as const)('selects %s through a portal and respects scopeDisabled', (label, initial, combined, callback, options) => {
    const values = { ...props(), onScheduleSourceChange: vi.fn() };
    const { container, rerender } = render(<PlanningBoardToolbar {...values} />);
    const trigger = screen.getByRole('button', { name: label, exact: true });
    expect(trigger).toHaveTextContent(initial);
    expect(trigger).toHaveClass('min-h-11', 'bg-slate-100');
    expect(trigger.parentElement?.previousElementSibling).toBe(label === '区分'
      ? screen.getByRole('button', { name: '製番登録ペインを開く' })
      : screen.getByRole('button', { name: '区分' }).parentElement);
    for (const [value, optionLabel] of options) {
      fireEvent.click(trigger);
      const panel = screen.getByRole('group', { name: label });
      expect(container).not.toContainElement(panel);
      expect(panel).toHaveAttribute('data-planning-board-popover');
      expect(within(panel).getAllByRole('button').map((button) => button.textContent)).toEqual(options.map((option) => option[1]));
      expect(within(panel).getByRole('button', { pressed: true })).toHaveFocus();
      expect(within(panel).getByRole('button', { pressed: true })).toHaveClass('bg-slate-100', 'text-slate-950');
      fireEvent.click(within(panel).getByRole('button', { name: optionLabel, exact: true }));
      expect(values[callback]).toHaveBeenLastCalledWith(value);
      expect(screen.queryByRole('group', { name: label })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      rerender(<PlanningBoardToolbar {...values} {...(label === '工程' ? { category: value as 'cutting' | 'all' | 'grinding' } : { scheduleSource: value as 'general' | 'dCompany' | 'both' })} />);
    }
    rerender(<PlanningBoardToolbar {...values} category="all" scheduleSource="both" />);
    expect(trigger).toHaveTextContent(combined);
    rerender(<PlanningBoardToolbar {...values} scopeDisabled />);
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('group', { name: label })).not.toBeInTheDocument();
  });
  it.each(['工程', '区分'])('closes %s on outside click, Escape, resize and ancestor scroll', (label) => {
    render(<PlanningBoardToolbar {...props()} />);
    const trigger = screen.getByRole('button', { name: label, exact: true });
    for (const close of [() => fireEvent.pointerDown(document.body), () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.resize(window), () => fireEvent.scroll(document)]) {
      fireEvent.click(trigger);
      const panel = screen.getByRole('group', { name: label });
      fireEvent.pointerDown(within(panel).getAllByRole('button')[0]!);
      fireEvent.scroll(panel);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      close();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
    }
  });
  it('keeps dropdowns open on sibling Gantt scroll and closes on anchor ancestor scroll', () => {
    const { container } = render(<div><PlanningBoardToolbar {...props()} /><div data-testid="gantt-scroll" /></div>);
    const trigger = screen.getByRole('button', { name: '区分', exact: true });
    fireEvent.click(trigger);
    fireEvent.scroll(screen.getByTestId('gantt-scroll'));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.scroll(container.firstElementChild!);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('toggles mode and navigates late work', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    expect(screen.getByRole('button', { name: '今日から' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '納期から' }));
    expect(values.onGanttModeChange).toHaveBeenCalledWith('backward');
    fireEvent.click(screen.getByRole('button', { name: '遅れ 2' }));
    expect(values.onNextLate).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
      .filter((label) => ['固定', '並べ替え', '納期順に並べる', '↶ 戻す'].includes(label!)))
      .toEqual(['固定', '並べ替え', '納期順に並べる', '↶ 戻す']);
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(values.onProposeOrder).toHaveBeenCalledOnce();
    expect(values.onSortDue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '納期順に並べる' }));
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    expect(values.onSortDue).toHaveBeenCalledOnce();
    expect(values.onUndoOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} lateCount={0} />);
    expect(screen.getByRole('button', { name: '遅れなし' })).toBeInTheDocument();
  });
  it.each([{ allocation: 'original' as const }, { orderDisabled: true }])('disables writes: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.getByRole('button', { name: '並べ替え' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
  });
  it.each([{ ganttEnabled: false }, { ganttMode: 'backward' as const }, { view: 'seiban' as const }])('hides pin and proposal outside forward resource view: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.queryByRole('button', { name: '固定' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '並べ替え' })).not.toBeInTheDocument();
  });
  it('keeps the original due-sort availability outside resource view', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} view="seiban" />);
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeEnabled();
    rerender(<PlanningBoardToolbar {...values} ganttMode="backward" />);
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeDisabled();
  });
  it('shows comparison and blocks pending preview actions', () => {
    const values = props();
    const onApplyOrder = vi.fn(); const onCancelOrder = vi.fn();
    const preview = { before: { lateCount: 3, waitMinutes: 125 }, after: { lateCount: 1, waitMinutes: 30 } };
    const { rerender } = render(<PlanningBoardToolbar {...values} orderPreview={preview} onApplyOrder={onApplyOrder} onCancelOrder={onCancelOrder} />);
    expect(screen.getByRole('status')).toHaveTextContent('遅れ 3 → 1 件');
    expect(screen.getByRole('status')).toHaveTextContent('待ち 2時間05分 → 0時間30分');
    expect(screen.queryByRole('button', { name: '並べ替え' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '納期順に並べる' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '固定' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onApplyOrder).toHaveBeenCalledOnce(); expect(onCancelOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} orderPreview={preview} previewPending />);
    expect(screen.getByRole('button', { name: '適用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled();
  });
  it('disables undo without history and keeps feedback shrinkable', () => {
    render(<PlanningBoardToolbar {...props()} canUndoOrder={false} feedback={<span>保存中</span>} />);
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
    expect(screen.getByText('保存中').parentElement).toHaveClass('min-w-0', 'flex-1');
  });
});

function SingleResourceToolbar({ resources = ['305', '306'] }: { resources?: string[] }) {
  const [resource, setResource] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <PlanningBoardToolbar {...props()} singleResourceCd={resource} singleResourceLanes={resources}
    singleResourceNameMap={{ '305': ['NC旋盤'], '306': ['研削盤'] }} singleResourcePickerAnchor={anchor}
    onOpenSingleResourcePicker={setAnchor} onCloseSingleResourcePicker={() => setAnchor(null)}
    onSingleResourceChange={(next) => { setResource(next); setAnchor(null); }} />;
}
describe('single resource toolbar', () => {
  it('opens a portaled picker inside the Gantt group, chooses a machine and exits with ✕', () => {
    render(<SingleResourceToolbar />);
    const button = screen.getByRole('button', { name: '1台', exact: true });
    expect(button.parentElement).toContainElement(screen.getByRole('button', { name: 'ガント', exact: true }));
    fireEvent.click(button);
    const picker = screen.getByRole('group', { name: '1台の資源CD' });
    expect(picker.parentElement).toBe(document.body);
    expect(within(picker).getByRole('button', { name: '305 NC旋盤' })).toHaveFocus();
    fireEvent.click(within(picker).getByRole('button', { name: '306 研削盤' }));
    expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
    expect(button).toHaveTextContent('306 ✕');
    fireEvent.click(button);
    expect(button).toHaveTextContent('1台');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
  it('closes on outside click and Escape, returns focus, and makes scale/picker mutually exclusive', () => {
    render(<SingleResourceToolbar />);
    const button = screen.getByRole('button', { name: '1台', exact: true });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '他の幅' }));
    fireEvent.click(button);
    expect(screen.queryByRole('group', { name: '他の幅' })).toBeNull();
    expect(screen.getByRole('group', { name: '1台の資源CD' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '他の幅' }));
    expect(screen.queryByRole('group', { name: '1台の資源CD' })).toBeNull();
  });
});

describe('two machine picker', () => {
  it.each([[['021']], [['022']], [['305']], [[]]])('does not offer the pair for lanes %j', (resources) => {
    render(<SingleResourceToolbar resources={resources} />);
    fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
    expect(screen.queryByRole('button', { name: '021+022 2台' })).toBeNull();
  });
  it('offers only individual resources even when both legacy machines are available', () => {
    render(<SingleResourceToolbar resources={['022', '021']} />);
    fireEvent.click(screen.getByRole('button', { name: '1台', exact: true }));
    const picker = screen.getByRole('group', { name: '1台の資源CD' });
    expect(within(picker).getAllByRole('button')).toHaveLength(2);
    expect(within(picker).queryByRole('button', { name: /2台/ })).toBeNull();
  });
});
