import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardItemTable } from '../PlanningBoardItemTable';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (itemId: string, partial: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId,
  kind: 'row',
  itemRevision: `${itemId}-0`,
  version: 0,
  sourceRowId: itemId,
  fseiban: 'CA1S1M11',
  fhincd: `MD-${itemId}`,
  fhinmei: `部品${itemId}`,
  machineName: 'MX-520',
  productNo: '0003594297',
  processOrder: '10',
  originalResourceCd: '305',
  effectiveResourceCd: '305',
  originalDueDate: '2026-10-08',
  effectiveDueDate: '2026-10-08',
  originalRank: null,
  alternateRank: null,
  plannedQuantity: 2,
  requiredMinutes: 120,
  requiredMinutesKnown: true,
  isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: true },
  ...partial
});

const items = [
  item('a', { materialArrivalStatus: 'received' }),
  item('b', { materialArrivalStatus: 'ordered' }),
  item('c'),
  item('d', { materialArrivalStatus: 'ordered', materialArrivalBasis: 'part' }),
  item('e', { materialArrivalStatus: 'received', placement: { shelves: [{ shelfCodeRaw: 'A', label: '棚A', placedAt: '2026-10-24T06:20:00Z' }] } }),
  item('f', { placement: { shelves: [{ shelfCodeRaw: 'B', label: '棚B', placedAt: '2026-10-24T06:20:00Z' }] } })
];

const renderTable = (props: { showRank?: boolean; showSeiban?: boolean }) =>
  render(
    <PlanningBoardItemTable
      items={items}
      allocation="alternate"
      selectedItemIds={new Set()}
      onToggleItem={vi.fn()}
      onResourceClick={vi.fn()}
      showColumnHeaders={false}
      tableLabel="test"
      {...props}
    />
  );

describe('PlanningBoardItemTable material arrival badge', () => {
  it.each([
    ['seiban pane', {}],
    ['focus view', { showRank: true }],
    ['resource view', { showRank: true, showSeiban: true }]
  ])('shows the badge only for items with a material status (%s)', (_label, props) => {
    renderTable(props);
    expect(within(screen.getByTestId('planning-board-item-a')).getByText('材料入荷済')).toBeInTheDocument();
    expect(within(screen.getByTestId('planning-board-item-b')).getByText('材料未入荷')).toBeInTheDocument();
    expect(within(screen.getByTestId('planning-board-item-c')).queryByText(/^材料/)).toBeNull();
    expect(within(screen.getByTestId('planning-board-item-d')).getByText('部品未入荷')).toBeInTheDocument();
    const placed = within(screen.getByTestId('planning-board-item-e'));
    expect(placed.getByText('棚A')).toBeInTheDocument();
    expect(placed.queryByText(/^材料/)).toBeNull();
    expect(within(screen.getByTestId('planning-board-item-f')).getByText('棚B')).toBeInTheDocument();
    fireEvent.click(placed.getByText('棚A'));
    expect(screen.getByTestId('planning-board-item-e').querySelector('input')).not.toBeChecked();
  });

  it('puts the badge under date, quantity and time in the seiban pane', () => {
    renderTable({});
    const cells = screen.getByTestId('planning-board-item-a').querySelectorAll('td');
    const dueCell = cells[cells.length - 1];
    expect(dueCell).toHaveTextContent('10/082個120分材料入荷済');
  });

  it('keeps the badge on the seiban and machine line in the resource view', () => {
    renderTable({ showRank: true, showSeiban: true });
    const badge = within(screen.getByTestId('planning-board-item-a')).getByText('材料入荷済');
    expect(badge.parentElement).toHaveTextContent('CA1S1M11 · MX-520材料入荷済');
  });
});
