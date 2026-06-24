import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      opts.count > 0 ? [{ index: 0, start: 0, key: 'virtual-0' }] : [],
    getTotalSize: () => opts.count * 100,
    measureElement: vi.fn(),
    measure: vi.fn()
  })
}));

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_RULER_BAR_WIDTH_PX,
  GANTT_RULER_GUTTER_WIDTH_PX,
  GANTT_TEN_HOURS_MINUTES
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
  onOpenInspectionWorkflow: noop,
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
  it('renders pointer-events-none gutter with visible and transparent alternating ruler bands', () => {
    render(
      <LeaderBoardGanttTickGutter
        totalHeightPx={200}
        rulerSegments={[
          { topPx: 0, heightPx: 96, bandIndex: 0 },
          { topPx: 96, heightPx: 104, bandIndex: 1 }
        ]}
      />
    );

    const gutter = screen.getByTestId('leader-board-gantt-ruler-gutter');
    expect(gutter).toHaveClass('pointer-events-none');
    expect(gutter).toHaveAttribute('aria-hidden', 'true');
    expect(gutter).toHaveStyle({ width: `${GANTT_RULER_GUTTER_WIDTH_PX}px`, height: '200px' });

    const bands = screen.getAllByTestId('leader-board-gantt-ruler-band');
    expect(bands).toHaveLength(2);
    expect(bands[0]).toHaveAttribute('data-band-index', '0');
    expect(bands[1]).toHaveAttribute('data-band-index', '1');
    expect(bands[0]).toHaveClass('bg-cyan-400/90');
    expect(bands[1]).toHaveClass('bg-transparent');
    expect(bands[0]).toHaveStyle({
      top: '0px',
      height: '96px',
      width: `${GANTT_RULER_BAR_WIDTH_PX}px`
    });
    expect(bands[1]).toHaveStyle({
      top: '96px',
      height: '104px',
      width: `${GANTT_RULER_BAR_WIDTH_PX}px`
    });
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
    expect(screen.queryByTestId('leader-board-gantt-ruler-gutter')).toBeNull();
  });

  it('keeps h-full and renders 8H ruler gutter when gantt is on', () => {
    const { container } = render(<LeaderOrderResourceCard {...cardProps} ganttEnabled />);

    expect(container.firstElementChild).toHaveClass('h-full');
    const gutter = screen.getByTestId('leader-board-gantt-ruler-gutter');
    expect(gutter).toBeInTheDocument();
    expect(gutter).toHaveClass('pointer-events-none');
    expect(screen.getAllByTestId('leader-board-gantt-ruler-band').length).toBeGreaterThan(0);
  });

  it('renders remainder band when capacityMinutes is injected for 10H workload', () => {
    render(
      <LeaderOrderResourceCard
        {...cardProps}
        ganttEnabled
        capacityMinutes={480}
        rows={[mkLeaderBoardRow({ id: 'r10h', fkojun: '10', requiredMinutes: 600 })]}
      />
    );

    const bands = screen.getAllByTestId('leader-board-gantt-ruler-band');
    expect(bands).toHaveLength(2);
    expect(bands[0]).toHaveAttribute('data-band-index', '0');
    expect(bands[1]).toHaveAttribute('data-band-index', '1');
    expect(bands[0]).toHaveClass('bg-cyan-400/90');
    expect(bands[1]).toHaveClass('bg-transparent');
  });

  it('uses injected capacityMinutes to change band count for the same workload', () => {
    const rows = [mkLeaderBoardRow({ id: 'r18h', fkojun: '10', requiredMinutes: 1080 })];
    const { unmount: unmount8h } = render(
      <LeaderOrderResourceCard {...cardProps} ganttEnabled capacityMinutes={480} rows={rows} />
    );
    const bands8h = screen.getAllByTestId('leader-board-gantt-ruler-band');
    expect(bands8h).toHaveLength(3);
    expect(bands8h.map((band) => band.getAttribute('data-band-index'))).toEqual(['0', '1', '2']);
    unmount8h();

    render(
      <LeaderOrderResourceCard {...cardProps} ganttEnabled capacityMinutes={720} rows={rows} />
    );
    const bands12h = screen.getAllByTestId('leader-board-gantt-ruler-band');
    expect(bands12h).toHaveLength(2);
    expect(bands12h.map((band) => band.getAttribute('data-band-index'))).toEqual(['0', '1']);
  });

  it('does not render ruler gutter when slot has zero rows', () => {
    render(<LeaderOrderResourceCard {...cardProps} ganttEnabled rows={[]} />);

    expect(screen.queryByTestId('leader-board-gantt-ruler-gutter')).toBeNull();
    expect(screen.getByText('行なし')).toBeInTheDocument();
  });

  it('does not cap card height with maxHeight when gantt is on', () => {
    const { container } = render(<LeaderOrderResourceCard {...cardProps} ganttEnabled />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.style.maxHeight).toBe('');

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
    const expectedLeft = `${GANTT_RULER_GUTTER_WIDTH_PX + 4}px`;
    for (const virtualRow of virtualRows) {
      expect(virtualRow.style.left).toBe(expectedLeft);
      expect(virtualRow.style.width).toBe(`calc(100% - ${GANTT_RULER_GUTTER_WIDTH_PX + 4}px)`);
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

describe('LeaderOrderResourceCard labor toggle', () => {
  it('renders capacity toggle immediately to the left of +人', () => {
    const onToggleCapacityMinutes = vi.fn();
    const onToggleLabor = vi.fn();
    render(
      <LeaderOrderResourceCard
        {...cardProps}
        capacityMinutes={GANTT_EIGHT_HOURS_MINUTES}
        onToggleCapacityMinutes={onToggleCapacityMinutes}
        laborEnabled={false}
        onToggleLabor={onToggleLabor}
      />
    );

    const capacityToggle = screen.getByRole('button', { name: '基準時間を10Hにする' });
    const laborToggle = screen.getByRole('button', { name: '人工数を含む表示をオンにする' });
    expect(capacityToggle).toHaveTextContent('8H');
    expect(capacityToggle).toHaveAttribute('aria-pressed', 'false');
    expect(capacityToggle.nextElementSibling).toBe(laborToggle);

    fireEvent.click(capacityToggle);
    expect(onToggleCapacityMinutes).toHaveBeenCalledTimes(1);
    expect(onToggleLabor).not.toHaveBeenCalled();
  });

  it('shows 10H state when capacityMinutes is 600', () => {
    render(
      <LeaderOrderResourceCard
        {...cardProps}
        capacityMinutes={GANTT_TEN_HOURS_MINUTES}
        onToggleCapacityMinutes={vi.fn()}
      />
    );

    const capacityToggle = screen.getByRole('button', { name: '基準時間を8Hにする' });
    expect(capacityToggle).toHaveTextContent('10H');
    expect(capacityToggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows required minutes label and toggles aria-pressed', () => {
    const onToggleLabor = vi.fn();
    render(
      <LeaderOrderResourceCard
        {...cardProps}
        rows={[
          mkLeaderBoardRow({
            id: 'r-labor',
            fkojun: '10',
            machineRequiredMinutes: 400,
            laborRequiredMinutes: 175,
            requiredMinutes: 400
          })
        ]}
        laborEnabled={false}
        onToggleLabor={onToggleLabor}
      />
    );

    expect(screen.getByText('400分')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: '人工数を含む表示をオンにする' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleLabor).toHaveBeenCalledTimes(1);
  });

  it('shows combined minutes when laborEnabled', () => {
    render(
      <LeaderOrderResourceCard
        {...cardProps}
        rows={[
          mkLeaderBoardRow({
            id: 'r-labor-on',
            fkojun: '10',
            machineRequiredMinutes: 400,
            laborRequiredMinutes: 175,
            requiredMinutes: 575
          })
        ]}
        laborEnabled
        onToggleLabor={vi.fn()}
      />
    );

    expect(screen.getByText('575分')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '人工数を含む表示をオフにする' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('updates cumulative gantt capacity bands when combined labor minutes increase required minutes', () => {
    const laborRow = {
      id: 'r-labor-gantt',
      fkojun: '10',
      machineRequiredMinutes: 400,
      laborRequiredMinutes: 175
    };
    const { rerender } = render(
      <LeaderOrderResourceCard
        {...cardProps}
        ganttEnabled
        capacityMinutes={GANTT_EIGHT_HOURS_MINUTES}
        rows={[mkLeaderBoardRow({ ...laborRow, requiredMinutes: 400 })]}
        laborEnabled={false}
        onToggleLabor={vi.fn()}
      />
    );

    expect(screen.getByText('400分')).toBeInTheDocument();
    expect(screen.getByTestId('leader-board-gantt-ruler-gutter')).toHaveStyle({ height: '480px' });
    expect(
      screen
        .getAllByTestId('leader-board-gantt-ruler-band')
        .map((band) => band.getAttribute('data-band-index'))
    ).toEqual(['0']);

    rerender(
      <LeaderOrderResourceCard
        {...cardProps}
        ganttEnabled
        capacityMinutes={GANTT_EIGHT_HOURS_MINUTES}
        rows={[mkLeaderBoardRow({ ...laborRow, requiredMinutes: 575 })]}
        laborEnabled
        onToggleLabor={vi.fn()}
      />
    );

    expect(screen.getByText('575分')).toBeInTheDocument();
    expect(screen.getByTestId('leader-board-gantt-ruler-gutter')).not.toHaveStyle({ height: '575px' });
    expect(
      screen
        .getAllByTestId('leader-board-gantt-ruler-band')
        .map((band) => band.getAttribute('data-band-index'))
    ).toEqual(['0', '1']);
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
    onOpenInspectionWorkflow: noop,
    footerResourceChipsByPartKey: new Map()
  };

  it('uses 1fr grid rows when gantt is off', () => {
    const { container } = render(<LeaderBoardGrid {...gridProps} ganttEnabled={false} />);
    expect(container.firstElementChild?.className).toContain('[grid-auto-rows:minmax(14rem,1fr)]');
    expect(container.firstElementChild?.className).not.toContain('auto-rows-auto');
  });

  it('uses 1fr grid rows when gantt is on', () => {
    const { container } = render(<LeaderBoardGrid {...gridProps} ganttEnabled />);
    expect(container.firstElementChild?.className).toContain('[grid-auto-rows:minmax(14rem,1fr)]');
    expect(container.firstElementChild?.className).not.toContain('auto-rows-auto');
    expect(screen.getByText('305')).toBeInTheDocument();
  });

  it('passes per-slot capacity minutes to the gantt ruler', () => {
    const rows = [mkLeaderBoardRow({ id: 'r18h-grid', fkojun: '10', requiredMinutes: 1080 })];
    render(
      <LeaderBoardGrid
        {...gridProps}
        sortedGrouped={new Map([['305', rows]])}
        ganttEnabled
        capacityMinutesBySlotIndex={[GANTT_TEN_HOURS_MINUTES]}
      />
    );

    const bands = screen.getAllByTestId('leader-board-gantt-ruler-band');
    expect(bands).toHaveLength(2);
    expect(bands.map((band) => band.getAttribute('data-band-index'))).toEqual(['0', '1']);
  });
});
