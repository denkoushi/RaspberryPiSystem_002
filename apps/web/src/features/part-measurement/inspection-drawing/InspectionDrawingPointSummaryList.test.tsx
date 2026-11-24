import { render } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { InspectionDrawingPointSummaryList } from './InspectionDrawingPointSummaryList';
import { createInspectionDrawingPoint } from './markerNumbering';

function mockScrollIntoView() {
  const scrollIntoView = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scrollIntoView;
  onTestFinished(() => { Element.prototype.scrollIntoView = original; });
  return scrollIntoView;
}

describe('InspectionDrawingPointSummaryList', () => {
  const points = [createInspectionDrawingPoint(0.1, 0.1, 1), createInspectionDrawingPoint(0.9, 0.9, 2)];

  it('scrolls the selected point into view when the selection changes', () => {
    const scrollIntoView = mockScrollIntoView();
    const { rerender, getByRole } = render(
      <InspectionDrawingPointSummaryList points={points} selectedPointId={null} onSelectPoint={vi.fn()} variant="sidebar" scrollSelectedIntoView />
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(
      <InspectionDrawingPointSummaryList points={points} selectedPointId={points[1].id} onSelectPoint={vi.fn()} variant="sidebar" scrollSelectedIntoView />
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(getByRole('button', { name: /No\.2/ }).closest('[role="listitem"]'));
  });

  it('does not scroll unless asked', () => {
    const scrollIntoView = mockScrollIntoView();
    render(<InspectionDrawingPointSummaryList points={points} selectedPointId={points[1].id} onSelectPoint={vi.fn()} variant="sidebar" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
