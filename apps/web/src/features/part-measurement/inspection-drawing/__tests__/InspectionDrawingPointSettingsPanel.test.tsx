import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO } from '../inspectionDrawingPointPosition';
import { InspectionDrawingPointSettingsPanel } from '../InspectionDrawingPointSettingsPanel';

import type { InspectionDrawingPoint } from '../types';

const point: InspectionDrawingPoint = {
  id: 'pt-1',
  name: '穴径',
  markerNo: 1,
  xRatio: 0.4,
  yRatio: 0.6,
  nominalRaw: '10',
  upperToleranceRaw: '0.05',
  lowerToleranceRaw: '-0.05',
  testValue: '',
  decimalPlaces: 3
};

describe('InspectionDrawingPointSettingsPanel', () => {
  it('renders nudge controls above the settings title and omits tolerance helper text', () => {
    render(<InspectionDrawingPointSettingsPanel point={point} onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: '測定点の位置調整' })).toBeInTheDocument();
    expect(screen.getByText('測定点の設定（No.1）')).toBeInTheDocument();
    expect(
      screen.queryByText(/合格範囲は「基準値＋下限公差」/)
    ).not.toBeInTheDocument();
  });

  it('forwards nudge patch through onChange', () => {
    const onChange = vi.fn();

    render(<InspectionDrawingPointSettingsPanel point={point} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '上へ移動' }));

    expect(onChange).toHaveBeenCalledWith({
      xRatio: 0.4,
      yRatio: 0.6 - INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO
    });
  });
});
