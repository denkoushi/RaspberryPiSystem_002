import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeaderOrderResourceRow } from '../LeaderOrderResourceRow';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

const noop = vi.fn();

describe('LeaderOrderResourceRow', () => {
  it('keeps parent actions available when a cached obsolete status request returns 404', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Fixture for a browser cache left by the retired status endpoint.
    await expect(queryClient.fetchQuery({
      queryKey: ['kiosk-production-schedule-order-split-status'],
      queryFn: async () => { throw Object.assign(new Error('Not Found'), { status: 404 }); }
    })).rejects.toMatchObject({ status: 404 });
    const onComplete = vi.fn();
    const onNote = vi.fn();
    const onInspection = vi.fn();
    const onOrder = vi.fn();
    const row = mkLeaderBoardRow({ id: 'parent', plannedQuantity: 5, requiredMinutes: 100,
      hasSelfInspectionDrawing: true, selfInspectionTemplateId: 'template' });
    render(<QueryClientProvider client={queryClient}>
      <LeaderOrderResourceRow resourceCd="305" row={row} orderUsageNumbers={undefined}
        onOrderChange={onOrder} onCompleteRow={onComplete} onOpenNote={onNote}
        onOpenInspectionWorkflow={onInspection} completePending={false} orderPending={false} />
    </QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '完了にする' }));
    fireEvent.click(screen.getByRole('button', { name: '備考を追加' }));
    fireEvent.click(screen.getByRole('button', { name: '検査方法を選択' }));
    expect(onComplete).toHaveBeenCalledWith('parent', 'complete');
    expect(onNote).toHaveBeenCalledWith(row);
    expect(onInspection).toHaveBeenCalledWith(row);
    expect(screen.getByRole('button', { name: '資源内の順位、タップで設定' })).toBeEnabled();
    expect(screen.getByText('5個')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '指示数を分割' })).not.toBeInTheDocument();
    queryClient.clear();
  });

  it.each([
    ['2026-11-12', false],
    ['2026-11-08', true]
  ] as const)('styles displayed due %s as manual only when it matches the manual date', (displayDue, manual) => {
    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={mkLeaderBoardRow({ dueDate: '2026-11-08T00:00:00.000Z', displayDue })}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
      />
    );
    const due = screen.getByTitle(manual ? '手動納期（タップで変更）' : '表示納期（タップで変更）');
    expect(due.classList.contains('text-amber-200')).toBe(manual);
    expect(due.classList.contains('text-sky-300/90')).toBe(!manual);
  });

  it('renders part code, quantity, fkojun, and required minutes on the cluster row', () => {
    const row = mkLeaderBoardRow({
      id: 'row-cluster',
      fhincd: 'MH001',
      plannedQuantity: 3,
      fkojun: ' 10 ',
      requiredMinutes: 400
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
      />
    );

    const clusterLine = screen.getByText('MH001').closest('div');
    expect(clusterLine).toHaveTextContent('MH001·3個·10·400分');
    expect(screen.getByTitle('表示所要時間（分）')).toHaveTextContent('400分');
  });

  it('uses compact width for manual order anchor while keeping ranked font classes', () => {
    const row = mkLeaderBoardRow({
      id: 'row-order-width',
      processingOrder: 10
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
      />
    );

    const orderButton = screen.getByRole('button', { name: '資源内の順位 10、タップで変更' });
    expect(orderButton).toHaveClass('w-7');
    expect(orderButton).toHaveClass('text-sm');
    expect(orderButton).toHaveClass('font-semibold');
    expect(orderButton.className).not.toContain('w-14');
  });

  it('exposes full trimmed part name via title when fseiban truncates the row', () => {
    const longPartName = '  超長い品名テスト部品ABCDEFGHIJKLMNOPQRSTUVWXYZ  ';
    const trimmedPartName = longPartName.trim();
    const row = mkLeaderBoardRow({
      id: 'row-long-part',
      fseiban: 'BA123456',
      fhinmei: longPartName
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
      />
    );

    const partNameEl = screen.getByText(trimmedPartName);
    expect(partNameEl).toHaveAttribute('title', trimmedPartName);
    expect(partNameEl).toHaveClass('truncate');
    expect(screen.getByText('BA123456')).toBeInTheDocument();
  });

  it('exposes note text via title on the remark button when note is present', () => {
    const note = '急ぎ対応。再加工注意。';
    const row = mkLeaderBoardRow({
      id: 'row-note',
      fseiban: 'BA123456',
      fhinmei: '部品A',
      note
    });

    render(
      <LeaderOrderResourceRow
        resourceCd="305"
        row={row}
        orderUsageNumbers={undefined}
        onOrderChange={noop}
        onCompleteRow={noop}
        completePending={false}
        orderPending={false}
        onOpenNote={noop}
      />
    );

    expect(screen.getByRole('button', { name: '備考を編集。ホバーで全文を表示' })).toHaveAttribute('title', note);
  });

  it('shows the material arrival badge in the footer row, with or without process chips', () => {
    const renderRow = (
      row: ReturnType<typeof mkLeaderBoardRow>,
      chips: { rowId: string; resourceCd: string; isCompleted: boolean }[] = []
    ) =>
      render(
        <LeaderOrderResourceRow
          resourceCd="305"
          row={row}
          orderUsageNumbers={undefined}
          onOrderChange={noop}
          onCompleteRow={noop}
          completePending={false}
          orderPending={false}
          footerResourceChips={chips}
        />
      );

    const withChips = renderRow(mkLeaderBoardRow({ id: 'row-mat-1', materialArrivalStatus: 'partial' }), [
      { rowId: 'p1', resourceCd: '581', isCompleted: false }
    ]);
    expect(withChips.getByText('材料一部入荷済')).toBeInTheDocument();
    expect(withChips.getByText('581')).toBeInTheDocument();
    withChips.unmount();

    const withoutChips = renderRow(mkLeaderBoardRow({ id: 'row-mat-2', materialArrivalStatus: 'unordered' }));
    expect(withoutChips.getByText('材料未発注')).toBeInTheDocument();
    withoutChips.unmount();

    const substitute = renderRow(mkLeaderBoardRow({ id: 'row-part-1', materialArrivalStatus: 'ordered', materialArrivalBasis: 'part' }));
    expect(substitute.getByText('部品未入荷')).toBeInTheDocument();
    substitute.unmount();

    const noMaterial = renderRow(mkLeaderBoardRow({ id: 'row-mat-3' }));
    expect(noMaterial.queryByText(/^材料/)).toBeNull();
  });
});
