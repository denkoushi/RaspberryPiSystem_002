import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import { productionFixture } from '../__perf__/fixture';
import { planningBoardPartKey } from '../gantt/planningBoardGanttLayout';
import { PlanningBoardItemTable } from '../PlanningBoardItemTable';
import { PlanningBoardPiecesContext } from '../PlanningBoardPiecePopover';
import { PlanningBoardProcessChipsContext } from '../planningBoardProcessChips';

import type { ComponentProps } from 'react';

// One call per table row render, without adding instrumentation to production code.
vi.mock('../../productionSchedule/machineName', async (original) => {
  const actual = await original<typeof import('../../productionSchedule/machineName')>();
  return { ...actual, normalizeMachineName: vi.fn(actual.normalizeMachineName) };
});

const fixture = productionFixture(12);
const base: ComponentProps<typeof PlanningBoardItemTable> = {
  items: fixture.items, allocation: 'alternate', selectedItemIds: new Set(),
  onToggleItem: vi.fn(), onResourceClick: vi.fn(), onCompleteToggle: vi.fn(),
  onRankChange: vi.fn(), showRank: true, showSeiban: true, tableLabel: '工程'
};
const calls = () => vi.mocked(normalizeMachineName).mock.calls.length;

describe('PlanningBoardItemTable render isolation', () => {
  it.each([false, true])('keeps unchanged rows out of pending renders (pieces=%s)', (pieces) => {
    const items = pieces ? base.items.map((item, index) => index === 0
      ? { ...item, kind: 'piece' as const, parentItemId: 'parent', pieceId: 'p', pieceSetVersion: 1 } : item) : base.items;
    const actions = { enabled: pieces, createEnabled: pieces, isCutting: () => true,
      selectedItemsByParent: new Map(), subscribeBlocking: () => () => {},
      getBlocking: () => ({ blocked: false, message: '保存中…', isError: false }), onSplit: vi.fn(), onMerge: vi.fn() };
    const draw = (pending: boolean) => <PlanningBoardPiecesContext.Provider value={{ ...actions }}>
      <PlanningBoardProcessChipsContext.Provider value={new Map()}>
        <PlanningBoardItemTable {...base} items={items} rankDisabled={() => false}
          completionPendingItemIds={new Set(pending && pieces ? [items[0].itemId] : [])} />
      </PlanningBoardProcessChipsContext.Provider>
    </PlanningBoardPiecesContext.Provider>;
    const view = render(draw(false));
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(draw(true));
    expect(calls()).toBe(pieces ? 1 : 0);
    expect(within(screen.getByTestId(`planning-board-item-${items[0].itemId}`)).getByRole('button', { name: '完了にする' }).hasAttribute('disabled')).toBe(pieces);
    view.rerender(draw(false));
    expect(calls()).toBe(pieces ? 2 : 0);
  });

  it('shares unrelated rows after a split refetch and uses the latest callbacks and revisions', () => {
    const oldComplete = vi.fn();
    const newComplete = vi.fn();
    const view = render(<PlanningBoardItemTable {...base} onCompleteToggle={oldComplete} />);
    const parent = base.items[0];
    const children = [1, 2].map((position) => ({ ...parent, itemId: `piece:${position}`, kind: 'piece' as const,
      parentItemId: parent.itemId, pieceId: String(position), pieceSetVersion: 1, plannedQuantity: 1 }));
    // A real GET decodes fresh objects, including nested progress data.
    const items = JSON.parse(JSON.stringify([...children, ...base.items.slice(1)]));
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(<PlanningBoardItemTable {...base} items={items} onCompleteToggle={newComplete} />);
    expect(calls()).toBe(2);
    fireEvent.click(within(screen.getByTestId(`planning-board-item-${base.items[1].itemId}`)).getByRole('button', { name: '完了にする' }));
    expect(newComplete).toHaveBeenCalledWith(items[2], 'complete');
    expect(oldComplete).not.toHaveBeenCalled();
    items[2] = { ...items[2], itemRevision: 'latest-revision' };
    view.rerender(<PlanningBoardItemTable {...base} items={[...items]} onCompleteToggle={newComplete} />);
    expect(calls()).toBe(3);
    fireEvent.click(within(screen.getByTestId(`planning-board-item-${base.items[1].itemId}`)).getByRole('button', { name: '完了にする' }));
    expect(newComplete.mock.calls.at(-1)?.[0].itemRevision).toBe('latest-revision');
  });

  it('redraws only rows whose process chips change', () => {
    const chips = [{ rowId: 'chip', resourceCd: '300', isCompleted: false }];
    const part = planningBoardPartKey(base.items[0]);
    const draw = (processes: typeof chips) => <PlanningBoardProcessChipsContext.Provider value={new Map([[part, processes]])}>
      <PlanningBoardItemTable {...base} />
    </PlanningBoardProcessChipsContext.Provider>;
    const view = render(draw(chips));
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(draw(chips));
    expect(calls()).toBe(0);
    view.rerender(draw([{ ...chips[0], isCompleted: true }]));
    expect(calls()).toBe(3); // Three operations of the same part share its chips.
  });

  it('keeps an open rank menu on the latest callback and revision and closes on Escape', () => {
    const oldRank = vi.fn();
    const newRank = vi.fn();
    const view = render(<PlanningBoardItemTable {...base} onRankChange={oldRank} />);
    const row = screen.getByTestId(`planning-board-item-${base.items[0].itemId}`);
    const trigger = within(row).getByRole('button', { name: /の個別指定$/ });
    fireEvent.click(trigger);
    const items = base.items.map((item, index) => index === 0 ? { ...item, itemRevision: 'new-rank-revision' } : item);
    view.rerender(<PlanningBoardItemTable {...base} items={items} onRankChange={newRank} />);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    fireEvent.click(within(panel).getByRole('button', { name: '2', exact: true }));
    expect(newRank).toHaveBeenCalledWith(items[0], 2);
    expect(oldRank).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('updates all visibly disabled rank and drag controls while keeping completion scoped', () => {
    const pointerDown = vi.fn();
    const draw = (pending: boolean) => <PlanningBoardItemTable {...base} rankDisabled={pending}
      resourceDragDisabled={pending} onResourcePointerDown={pointerDown} completionPendingItemIds={new Set(pending ? [base.items[0].itemId] : [])} />;
    const view = render(draw(false));
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(draw(true));
    expect(calls()).toBe(12); // Every rank button and drag cursor really changes.
    expect(screen.getAllByRole('button', { name: /の個別指定$/ }).every((button) => button.hasAttribute('disabled'))).toBe(true);
    const resource = within(screen.getByTestId(`planning-board-item-${base.items[1].itemId}`)).getByRole('button', { name: /資源CD .*を変更/ });
    expect(resource).not.toHaveClass('cursor-grab');
    fireEvent.pointerDown(resource, { button: 0 });
    expect(pointerDown).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: '完了にする' }).filter((button) => button.hasAttribute('disabled'))).toHaveLength(1);
    view.rerender(draw(false));
    expect(calls()).toBe(24);
    expect(resource).toHaveClass('cursor-grab');
    expect(screen.getAllByRole('button', { name: /の個別指定$/ }).every((button) => !button.hasAttribute('disabled'))).toBe(true);
  });

  it('does not render any row for the outer writing gate and guards an already open portal', () => {
    const onRankChange = vi.fn();
    const draw = (writing: boolean) => <div data-planning-board-pieces-writing={writing}>
      <PlanningBoardItemTable {...base} onRankChange={onRankChange} />
    </div>;
    const view = render(draw(false));
    const trigger = within(screen.getByTestId(`planning-board-item-${base.items[0].itemId}`)).getByRole('button', { name: /の個別指定$/ });
    fireEvent.click(trigger);
    const choice = within(document.getElementById(trigger.getAttribute('aria-controls')!)!).getByRole('button', { name: '2', exact: true });
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(draw(true));
    expect(calls()).toBe(0);
    expect(trigger).toBeEnabled();
    fireEvent.click(choice);
    expect(onRankChange).not.toHaveBeenCalled();
    vi.mocked(normalizeMachineName).mockClear();
    view.rerender(draw(false));
    expect(calls()).toBe(0);
    fireEvent.click(choice);
    expect(onRankChange).toHaveBeenCalledWith(base.items[0], 2);
  });

  it('updates optional completion and rank control availability', () => {
    const view = render(<PlanningBoardItemTable {...base} />);
    view.rerender(<PlanningBoardItemTable {...base} onCompleteToggle={undefined} onRankChange={undefined} />);
    expect(screen.queryByRole('button', { name: '完了にする' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /の個別指定$/ }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
