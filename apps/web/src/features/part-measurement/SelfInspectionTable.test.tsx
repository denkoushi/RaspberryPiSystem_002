import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { SelfInspectionTable, resolveSelfInspectionPaneCount } from './SelfInspectionTable';

import type { SelfInspectionTableRow } from './selfInspectionTableModel';

const rows: SelfInspectionTableRow[] = Array.from({ length: 5 }, (_, index) => ({
  kind: 'candidate',
  id: `row-${index + 1}`,
  productNo: `100${index + 1}`,
  resourceCd: '581',
  statusLabel: '未開始',
  statusTone: 'info',
  detailLine: `製番 A-${index + 1}`,
  progressLine: '指示数 10',
  action: { kind: 'button', label: '検査方法を選択' }
}));

describe('SelfInspectionTable', () => {
  it.each([
    [1279, 1],
    [1280, 2],
    [1535, 2],
    [1536, 3],
    [1920, 3]
  ])('resolves %ipx to %i panes', (width, expected) => {
    expect(resolveSelfInspectionPaneCount(width)).toBe(expected);
  });

  it('renders balanced panes for the current viewport and preserves one action per item', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1536 });
    const selected: string[] = [];
    render(
      <MemoryRouter>
        <SelfInspectionTable rows={rows} onCandidateSelect={(id) => selected.push(id)} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('self-inspection-table-panes')).toHaveAttribute('data-pane-count', '3');
    expect(screen.getAllByRole('table')).toHaveLength(3);
    const actions = screen.getAllByRole('button', { name: '検査方法を選択' });
    expect(actions).toHaveLength(5);
    fireEvent.click(actions[3]);
    expect(selected).toEqual(['row-4']);
  });
});
