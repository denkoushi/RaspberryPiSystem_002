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
  invalidationTarget: {
    kind: 'schedule_row',
    scheduleRowId: `00000000-0000-4000-8000-00000000000${index}`,
    templateId: '00000000-0000-4000-8000-000000000099',
    productNo: `100${index + 1}`,
    processGroup: 'cutting',
    resourceCd: '581',
    fseiban: `A-${index + 1}`,
    fhincd: 'P-1',
    fhinmei: '部品'
  },
  action: { kind: 'button', label: '検査方法を選択' }
}));

describe('SelfInspectionTable', () => {
  it.each([
    [1279, 1],
    [1280, 1],
    [1535, 1],
    [1536, 2],
    [1920, 2]
  ])('resolves %ipx to %i panes', (width, expected) => {
    expect(resolveSelfInspectionPaneCount(width)).toBe(expected);
  });

  it('renders balanced panes for the current viewport and preserves one action per item', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1536 });
    const selected: string[] = [];
    const invalidated: string[] = [];
    render(
      <MemoryRouter>
        <SelfInspectionTable
          rows={rows}
          onCandidateSelect={(id) => selected.push(id)}
          onInvalidate={(row) => invalidated.push(row.id)}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('self-inspection-table-panes')).toHaveAttribute('data-pane-count', '2');
    expect(screen.getAllByRole('table')).toHaveLength(2);
    const actions = screen.getAllByRole('button', { name: '検査方法を選択' });
    expect(actions).toHaveLength(5);
    fireEvent.click(actions[3]);
    expect(selected).toEqual(['row-4']);
    const deleteActions = screen.getAllByRole('button', { name: '削除' });
    expect(deleteActions).toHaveLength(5);
    fireEvent.click(deleteActions[1]);
    expect(invalidated).toEqual(['row-2']);
  });

  it('uses horizontal compact actions and readable non-11px content', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    render(
      <MemoryRouter>
        <SelfInspectionTable rows={rows.slice(0, 1)} onCandidateSelect={() => undefined} onInvalidate={() => undefined} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('self-inspection-row-actions')).toHaveClass('flex', 'flex-wrap');
    for (const action of screen.getAllByRole('button')) {
      expect(action).toHaveClass('!h-[30.8px]', '!min-h-[30.8px]', '!px-1', '!py-0', 'text-sm');
      expect(action).not.toHaveClass('w-full');
    }
    expect(screen.getByText('製番 A-1').closest('td')).toHaveClass('text-sm');
  });

  it('clips long labels within their cells while exposing the full values through titles', () => {
    const longRow: SelfInspectionTableRow = {
      ...rows[0]!,
      productNo: 'ORDER-VERY-LONG-1234567890',
      resourceCd: 'RESOURCE-VERY-LONG-1234567890',
      statusLabel: '非常に長い状態ラベル',
      detailLine: '製番・品番・品名を含む非常に長い詳細情報',
      progressLine: '非常に長い進捗情報'
    };
    render(
      <MemoryRouter>
        <SelfInspectionTable rows={[longRow]} onCandidateSelect={() => undefined} onInvalidate={() => undefined} />
      </MemoryRouter>
    );

    expect(screen.getByTitle(longRow.productNo)).toHaveClass('truncate');
    expect(screen.getByTitle(longRow.resourceCd)).toHaveClass('truncate');
    expect(screen.getByTitle(longRow.statusLabel)).toHaveClass('truncate');
    expect(screen.getByTitle(longRow.detailLine)).toHaveClass('line-clamp-1');
    expect(screen.getByTitle(longRow.progressLine)).toHaveClass('line-clamp-1');
    expect(screen.getByRole('table')).toHaveClass('w-full', 'table-fixed');
  });
});
