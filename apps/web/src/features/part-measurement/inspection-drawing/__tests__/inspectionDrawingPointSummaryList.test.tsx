import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingPointSummaryList } from '../InspectionDrawingPointSummaryList';

import type { InspectionDrawingPoint } from '../types';

function makePoint(overrides: Partial<InspectionDrawingPoint> & { id: string; markerNo: number }): InspectionDrawingPoint {
  return {
    id: overrides.id,
    markerNo: overrides.markerNo,
    name: overrides.name ?? '外径',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: overrides.nominalRaw ?? '10',
    lowerToleranceRaw: overrides.lowerToleranceRaw ?? '-0.1',
    upperToleranceRaw: overrides.upperToleranceRaw ?? '0.1',
    testValue: overrides.testValue ?? ''
  };
}

describe('InspectionDrawingPointSummaryList', () => {
  it('renders points in markerNo order with 2-line summary', () => {
    const points = [
      makePoint({ id: 'b', markerNo: 2, name: '全長' }),
      makePoint({ id: 'a', markerNo: 1, name: '外径', nominalRaw: '125' })
    ];

    render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="a"
        onSelectPoint={() => undefined}
        variant="sidebar"
      />
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('No.1');
    expect(items[0]).toHaveTextContent('外径');
    expect(items[0]).toHaveTextContent('基準');
    expect(items[0]).toHaveTextContent('125');
    expect(items[0]).toHaveTextContent('上限');
    expect(items[0]).toHaveTextContent('下限');
    expect(items[1]).toHaveTextContent('No.2');
  });

  it('calls onSelectPoint when a card is clicked', () => {
    const onSelect = vi.fn();
    const points = [makePoint({ id: 'p1', markerNo: 1 })];

    render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId={null}
        onSelectPoint={onSelect}
        variant="sidebar"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /測定点 No\.1/ }));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('shows empty message when there are no points', () => {
    render(
      <InspectionDrawingPointSummaryList
        points={[]}
        selectedPointId={null}
        onSelectPoint={() => undefined}
        variant="sidebar"
      />
    );

    expect(screen.getByText(/測定点がありません/)).toBeInTheDocument();
  });
});
