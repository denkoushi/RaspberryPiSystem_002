import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCreateSidebar } from './InspectionDrawingCreateSidebar';
import { createInspectionDrawingPoint } from './markerNumbering';

import type { InspectionDrawingPointSidebar } from './InspectionDrawingPointSidebar';
import type { InspectionDrawingPoint } from './types';
import type { PartMeasurementDrawingOcrCandidateDto } from '../types';
import type { ComponentProps } from 'react';

const candidate: PartMeasurementDrawingOcrCandidateDto = {
  valueText: '56', rawText: 'Φ56', confidence: 1, score: 1, distanceRatio: 0,
  xRatio: 0.3, yRatio: 0.4, widthRatio: 0.1, heightRatio: 0.1,
  passKind: 'full', preprocessKind: 'raw', rotation: 0, source: 'dimensionMap',
  suggestedUpperTolerance: '+0.03', suggestedLowerTolerance: '-0.02'
};

vi.mock('./InspectionDrawingPointSidebar', () => ({
  InspectionDrawingPointSidebar: (props: ComponentProps<typeof InspectionDrawingPointSidebar>) => (
    <div>
      <span>確定点パネル {props.mode}</span>
      <button type="button" onClick={() => props.onApplyOcrCandidate?.('56')}>OCR値</button>
      <button type="button" onClick={() => props.onApplyOcrCandidate?.('56', candidate)}>寸法マップ値</button>
    </div>
  )
}));

const placement: ComponentProps<typeof InspectionDrawingCreateSidebar>['placement'] = {
  proposals: [], unplaced: [], sourceDrawingName: null, selectedProposalId: null, armedId: null,
  tab: 'proposals', setTab: vi.fn(), selectProposal: vi.fn(), moveProposal: vi.fn(), approve: vi.fn(),
  approveAll: vi.fn(), reject: vi.fn(), arm: vi.fn(), placeArmed: vi.fn(), flushApprovals: vi.fn()
};

function renderSidebar(pointPatch: Partial<InspectionDrawingPoint> = {}, readOnly = false, guided = false) {
  const point = { ...createInspectionDrawingPoint(0.3, 0.4, 1), name: '内径', ...pointPatch };
  const onApplyOcrPointPatch = vi.fn();
  render(
    <InspectionDrawingCreateSidebar
      placement={placement} busy={false} onApplyOcrPointPatch={onApplyOcrPointPatch}
      mode={guided ? 'guidedTrial' : 'place'} onModeChange={vi.fn()}
      hasDrawingImage hasMeasurementPoints points={[point]} selectedPoint={point}
      contentReadOnly={readOnly} onSelectPoint={vi.fn()} onPointChange={vi.fn()} onTestValueChange={vi.fn()}
    />
  );
  return { point, onApplyOcrPointPatch };
}

describe('InspectionDrawingCreateSidebar existing behavior', () => {
  it.each([
    { readOnly: false, guided: false },
    { readOnly: true, guided: false },
    { readOnly: false, guided: true }
  ])('keeps the existing panel without proposal chrome: %j', ({ readOnly, guided }) => {
    renderSidebar({}, readOnly, guided);
    expect(screen.getByText(`確定点パネル ${guided ? 'guidedTrial' : 'place'}`)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '測定点の種類' })).not.toBeInTheDocument();
  });

  it('keeps the original explicit dimension-map tolerances', () => {
    const { point, onApplyOcrPointPatch } = renderSidebar();
    fireEvent.click(screen.getByText('寸法マップ値'));
    expect(onApplyOcrPointPatch).toHaveBeenCalledWith(point.id, {
      nominalRaw: '56', upperToleranceRaw: '+0.03', lowerToleranceRaw: '-0.02'
    });
  });

  it('does not overwrite existing tolerances when applying an OCR value', () => {
    const { point, onApplyOcrPointPatch } = renderSidebar({ upperToleranceRaw: '0.1' });
    fireEvent.click(screen.getByText('寸法マップ値'));
    expect(onApplyOcrPointPatch).toHaveBeenCalledWith(point.id, { nominalRaw: '56' });
  });

  it('keeps the depth lower bound', () => {
    const { point, onApplyOcrPointPatch } = renderSidebar({ name: '深さ' });
    fireEvent.click(screen.getByText('OCR値'));
    expect(onApplyOcrPointPatch).toHaveBeenCalledWith(point.id, { nominalRaw: '56', lowerToleranceRaw: '0' });
  });

  it('keeps the geometric-tolerance conversion', () => {
    const { point, onApplyOcrPointPatch } = renderSidebar({ name: '平面度' });
    fireEvent.click(screen.getByText('OCR値'));
    expect(onApplyOcrPointPatch).toHaveBeenCalledWith(point.id, {
      nominalRaw: '56', lowerToleranceRaw: '-56', upperToleranceRaw: '0'
    });
  });
});
