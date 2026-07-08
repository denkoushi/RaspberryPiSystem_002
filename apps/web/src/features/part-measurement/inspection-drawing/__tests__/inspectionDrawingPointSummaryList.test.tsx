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

  it('uses one-column layout by default for create/edit sidebar', () => {
    const points = [makePoint({ id: 'p1', markerNo: 1 })];

    const { container } = render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="p1"
        onSelectPoint={() => undefined}
        variant="sidebar"
      />
    );

    expect(container.querySelector('.grid-cols-2')).toBeNull();
    expect(container.querySelector('.flex.flex-col')).toBeTruthy();
    const button = screen.getByRole('button', { name: /測定点 No\.1/ });
    expect(button.className).toContain('bg-cyan-950/40');
    expect(button.className).toContain('ring-2');
    expect(button.className).toContain('ring-cyan-300/80');
  });

  it('uses two-column layout when layout is twoColumn', () => {
    const points = [makePoint({ id: 'p1', markerNo: 1 })];

    const { container } = render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="p1"
        onSelectPoint={() => undefined}
        variant="sidebar"
        layout="twoColumn"
      />
    );

    expect(container.querySelector('.grid.grid-cols-2')).toBeTruthy();
  });

  it('applies high-contrast selected styling in twoColumn layout', () => {
    const points = [makePoint({ id: 'p1', markerNo: 1 })];

    render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="p1"
        onSelectPoint={() => undefined}
        showMeasurementStatus
        variant="sidebar"
        layout="twoColumn"
      />
    );

    const button = screen.getByRole('button', { name: /測定点 No\.1/ });
    expect(button.className).toContain('ring-2');
    expect(button.className).toContain('ring-cyan-300');
  });

  it('shrinks measurement value row in twoColumn layout so status label stays visible', () => {
    const points = [makePoint({ id: 'p1', markerNo: 1, testValue: '12345678901234567890' })];

    const { container } = render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="p1"
        onSelectPoint={() => undefined}
        showMeasurementStatus
        variant="sidebar"
        layout="twoColumn"
      />
    );

    const valueRow = container.querySelector('.min-w-0.flex-1.truncate');
    expect(valueRow).toBeTruthy();
    expect(valueRow?.textContent).toContain('12345678901234567890');
    expect(screen.getByText('NG')).toBeInTheDocument();
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

  it('shows measurement value and status when showMeasurementStatus is enabled', () => {
    const points = [
      makePoint({ id: 'p1', markerNo: 1, testValue: '10' }),
      makePoint({ id: 'p2', markerNo: 2, testValue: 'abc' }),
      makePoint({
        id: 'p3',
        markerNo: 3,
        nominalRaw: '',
        lowerToleranceRaw: '',
        upperToleranceRaw: '',
        testValue: ''
      })
    ];

    render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId="p1"
        onSelectPoint={() => undefined}
        showMeasurementStatus
        variant="sidebar"
      />
    );

    expect(screen.getAllByText(/測定値/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('button', { name: /測定点 No\.1/ })).toHaveTextContent('10');
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('不正')).toBeInTheDocument();
    expect(screen.getByText('公差不備')).toBeInTheDocument();
  });

  it('calls onSelectPointerDownCapture before selection', () => {
    const onCapture = vi.fn();
    const onSelect = vi.fn();
    const points = [makePoint({ id: 'p1', markerNo: 1 })];

    render(
      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId={null}
        onSelectPoint={onSelect}
        onSelectPointerDownCapture={onCapture}
        showMeasurementStatus
        variant="sidebar"
      />
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: /測定点 No\.1/ }));
    fireEvent.click(screen.getByRole('button', { name: /測定点 No\.1/ }));
    expect(onCapture).toHaveBeenCalled();
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
