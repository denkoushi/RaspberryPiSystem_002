import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      opts.count > 0 ? [{ index: 0, start: 0, key: 'virtual-0' }] : [],
    getTotalSize: () => opts.count * 100,
    measureElement: vi.fn()
  })
}));

import {
  GANTT_CARD_MAX_HEIGHT_VH,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_TICK_GUTTER_WIDTH_PX
} from '../gantt/leaderBoardGanttConstants';
import { LeaderBoardGanttTickGutter } from '../gantt/LeaderBoardGanttTickGutter';
import { LeaderBoardGrid } from '../LeaderBoardGrid';
import { LeaderOrderResourceCard } from '../LeaderOrderResourceCard';
import { LeaderOrderResourceRow } from '../LeaderOrderResourceRow';
import { LEADER_BOARD_VIRTUAL_ROW_THRESHOLD } from '../performance/leaderBoardRefetchPolicy';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

const noop = vi.fn();

const cardProps = {
  resourceCd: '305',
  rows: [mkLeaderBoardRow({ id: 'r1', fkojun: '10', requiredMinutes: 480 })],
  selected: false,
  dimmed: false,
  onSelect: noop,
  orderUsageNumbers: undefined,
  onOrderChange: noop,
  onCompleteRow: noop,
  completePending: false,
  orderPending: false,
  footerResourceChipsByPartKey: new Map()
};

const rowProps = {
  resourceCd: '305',
  row: mkLeaderBoardRow({ id: 'r1', fkojun: '10' }),
  orderUsageNumbers: undefined,
  onOrderChange: noop,
  onCompleteRow: noop,
  completePending: false,
  orderPending: false
};

describe('LeaderBoardGanttTickGutter', () => {
  it('renders pointer-events-none gutter with 1px tick lines', () => {
    const { container } = render(
      <LeaderBoardGanttTickGutter totalHeightPx={200} tickPositions={[0, 96]} />
    );

    const gutter = container.firstElementChild as HTMLElement;
    expect(gutter).toHaveClass('pointer-events-none');
    expect(gutter).toHaveAttribute('aria-hidden', 'true');

    const ticks = container.querySelectorAll<HTMLElement>('.bg-cyan-400\\/55');
    expect(ticks).toHaveLength(2);
    expect(ticks[0].style.height).toBe('1px');
    expect(ticks[1].style.top).toBe('96px');
  });
});

describe('LeaderOrderResourceRow gantt', () => {
  it('does not set minHeight when gantt is off', () => {
    const { container } = render(
      <MemoryRouter>
        <LeaderOrderResourceRow {...rowProps} />
      </MemoryRouter>
    );

    const rowEl = container.firstElementChild as HTMLElement;
    expect(rowEl.style.minHeight).toBe('');
  });

  it('sets minHeight when gantt rowMinHeightPx is provided', () => {
    const { container } = render(
      <MemoryRouter>
        <LeaderOrderResourceRow {...rowProps} rowMinHeightPx={GANTT_MIN_ROW_HEIGHT_PX} />
      </MemoryRouter>
    );

    const rowEl = container.firstElementChild as HTMLElement;
    expect(rowEl.style.minHeight).toBe(`${GANTT_MIN_ROW_HEIGHT_PX}px`);
  });
});

describe('LeaderOrderResourceCard gantt', () => {
  it('keeps h-full when gantt is off', () => {
    const { container } = render(<LeaderOrderResourceCard {...cardProps} ganttEnabled={false} />);

    expect(container.firstElementChild).toHaveClass('h-full');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('drops h-full and renders 8H tick gutter when gantt is on', () => {
    const { container } = render(<LeaderOrderResourceCard {...cardProps} ganttEnabled />);

    expect(container.firstElementChild).not.toHaveClass('h-full');
    const gutter = container.querySelector('[aria-hidden="true"]');
    expect(gutter).toBeInTheDocument();
    expect(gutter).toHaveClass('pointer-events-none');
  });

  it('caps card height and uses flex-1 inner scroll when gantt is on', () => {
    const { container } = render(<LeaderOrderResourceCard {...cardProps} ganttEnabled />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.style.maxHeight).toBe(`${GANTT_CARD_MAX_HEIGHT_VH}vh`);

    const body = screen.getByTestId('leader-order-resource-card-body');
    expect(body).toHaveClass('flex-1');
    expect(body).toHaveClass('min-h-0');
    expect(body).toHaveClass('overflow-y-auto');
  });

  it('offsets virtual rows for gantt gutter when row count exceeds virtual threshold', () => {
    const rows = Array.from({ length: LEADER_BOARD_VIRTUAL_ROW_THRESHOLD + 1 }, (_, index) =>
      mkLeaderBoardRow({ id: `r${index}`, fkojun: String(index), requiredMinutes: 60 })
    );
    render(<LeaderOrderResourceCard {...cardProps} ganttEnabled rows={rows} />);

    const virtualRows = screen.getAllByTestId('leader-order-resource-card-virtual-row');
    expect(virtualRows.length).toBeGreaterThan(0);
    const expectedLeft = `${GANTT_TICK_GUTTER_WIDTH_PX + 4}px`;
    for (const virtualRow of virtualRows) {
      expect(virtualRow.style.left).toBe(expectedLeft);
      expect(virtualRow.style.width).toBe(`calc(100% - ${GANTT_TICK_GUTTER_WIDTH_PX + 4}px)`);
    }
  });

  it('keeps space-y-1 on body with direct row children when gantt is off', () => {
    const rows = [
      mkLeaderBoardRow({ id: 'r1', fkojun: '10' }),
      mkLeaderBoardRow({ id: 'r2', fkojun: '20' })
    ];
    const { container } = render(
      <LeaderOrderResourceCard {...cardProps} ganttEnabled={false} rows={rows} />
    );

    const body = screen.getByTestId('leader-order-resource-card-body');
    expect(body).toHaveClass('space-y-1');
    expect(body.children).toHaveLength(2);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('LeaderBoardGrid gantt', () => {
  const gridProps = {
    resourceCdBySlotIndex: ['305'],
    sortedGrouped: new Map([['305', cardProps.rows]]),
    resourceNameMap: {},
    orderUsageByResourceCd: undefined,
    selectedResourceCd: null,
    setSelectedResourceCd: noop,
    onOpenDueDatePicker: noop,
    dueDatePending: false,
    onOrderChange: noop,
    onCompleteRow: noop,
    completePending: false,
    orderPending: false,
    onOpenNote: noop,
    notePending: false,
    footerResourceChipsByPartKey: new Map()
  };

  it('uses 1fr grid rows when gantt is off', () => {
    const { container } = render(<LeaderBoardGrid {...gridProps} ganttEnabled={false} />);
    expect(container.firstElementChild?.className).toContain('[grid-auto-rows:minmax(14rem,1fr)]');
    expect(container.firstElementChild?.className).not.toContain('auto-rows-auto');
  });

  it('uses auto grid rows when gantt is on', () => {
    const { container } = render(<LeaderBoardGrid {...gridProps} ganttEnabled />);
    expect(container.firstElementChild?.className).toContain('auto-rows-auto');
    expect(container.firstElementChild?.className).toContain('[grid-auto-rows:minmax(14rem,auto)]');
    expect(screen.getByText('305')).toBeInTheDocument();
  });
});
