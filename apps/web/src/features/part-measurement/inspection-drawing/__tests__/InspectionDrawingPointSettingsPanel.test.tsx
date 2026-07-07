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

function focusToleranceInput(label: '上限公差' | '下限公差') {
  fireEvent.focus(screen.getByLabelText(label));
}

function visibleToleranceCandidateButtons(): string[] {
  const listbox = screen.getByRole('listbox', { name: '公差候補' });
  return Array.from(listbox.querySelectorAll('[role="option"]'))
    .map((button) => button.textContent ?? '')
    .filter(Boolean);
}

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

  it('renders OCR candidate chips and applies selected value', () => {
    const onApplyOcrCandidate = vi.fn();

    render(
      <InspectionDrawingPointSettingsPanel
        point={point}
        onChange={vi.fn()}
        ocrCandidates={[
          {
            valueText: '25',
            rawText: '25',
            confidence: 84,
            score: 0.01,
            distanceRatio: 0.01,
            xRatio: 0.62,
            yRatio: 0.54,
            widthRatio: 0.03,
            heightRatio: 0.02,
            passKind: 'tile',
            preprocessKind: 'raw',
            rotation: 0
          }
        ]}
        ocrCandidateStatus="completed"
        onApplyOcrCandidate={onApplyOcrCandidate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '25' }));

    expect(onApplyOcrCandidate).toHaveBeenCalledWith('25');
  });

  it('does not render OCR waiting states in the nominal value candidate row', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={point}
        onChange={vi.fn()}
        ocrCandidateStatus="pending"
      />
    );

    expect(screen.queryByText('OCR待ち')).not.toBeInTheDocument();
    expect(screen.queryByText('OCR処理中')).not.toBeInTheDocument();
  });

  it('shows geometric tolerance candidates for 直角度 when focused', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '直角度' }}
        onChange={vi.fn()}
      />
    );

    focusToleranceInput('上限公差');

    expect(visibleToleranceCandidateButtons()).toEqual([
      '0',
      '0.001',
      '0.002',
      '0.003',
      '0.004',
      '0.005',
      '0.006',
      '0.007',
      '0.008',
      '0.009'
    ]);
  });

  it('shows dimension tolerance candidates for 幅 when focused', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '幅' }}
        onChange={vi.fn()}
      />
    );

    focusToleranceInput('上限公差');

    expect(visibleToleranceCandidateButtons()).toContain('-0.9');
    expect(visibleToleranceCandidateButtons()).toContain('+0.9');
    expect(visibleToleranceCandidateButtons()).not.toContain('0.001');
  });

  it('switches 幅 to geometric candidates when configured', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '幅' }}
        onChange={vi.fn()}
        measurementLabelSettings={[{ label: '幅', toleranceKind: 'geometric' }]}
      />
    );

    focusToleranceInput('上限公差');

    expect(visibleToleranceCandidateButtons()).toContain('0.009');
    expect(visibleToleranceCandidateButtons()).not.toContain('+0.9');
  });

  it('keeps manual tolerance values outside candidates editable', () => {
    const onChange = vi.fn();

    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '幅', upperToleranceRaw: '0.025' }}
        onChange={onChange}
      />
    );

    const upperToleranceInput = screen.getByLabelText('上限公差') as HTMLInputElement;
    expect(upperToleranceInput.value).toBe('0.025');

    fireEvent.change(upperToleranceInput, { target: { value: '0.026' } });

    expect(onChange).toHaveBeenCalledWith({ upperToleranceRaw: '0.026' });
  });

  it('shows tolerance candidate chips when tolerance input is focused', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '直角度' }}
        onChange={vi.fn()}
      />
    );

    focusToleranceInput('上限公差');

    expect(screen.getByRole('listbox', { name: '公差候補' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '0.003' })).toBeInTheDocument();
  });

  it('applies tolerance candidate when chip is clicked', () => {
    const onChange = vi.fn();

    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '直角度', upperToleranceRaw: '' }}
        onChange={onChange}
      />
    );

    focusToleranceInput('上限公差');
    fireEvent.click(screen.getByRole('option', { name: '0.003' }));

    expect(onChange).toHaveBeenCalledWith({ upperToleranceRaw: '0.003' });
  });

  it('shows tolerance candidate chips even when current value is outside candidates', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '幅', upperToleranceRaw: '0.025' }}
        onChange={vi.fn()}
      />
    );

    focusToleranceInput('上限公差');

    expect(screen.getByRole('option', { name: '+0.9' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '-0.9' })).toBeInTheDocument();
  });

  it('does not show tolerance candidate chips when disabled', () => {
    render(
      <InspectionDrawingPointSettingsPanel
        point={{ ...point, name: '直角度' }}
        onChange={vi.fn()}
        disabled
      />
    );

    focusToleranceInput('上限公差');

    expect(screen.queryByRole('listbox', { name: '公差候補' })).not.toBeInTheDocument();
  });

  it('uses black text for nominal and tolerance inputs', () => {
    render(<InspectionDrawingPointSettingsPanel point={point} onChange={vi.fn()} />);

    expect(screen.getByLabelText('基準値')).toHaveClass('!text-black');
    expect(screen.getByLabelText('上限公差')).toHaveClass('!text-black');
    expect(screen.getByLabelText('下限公差')).toHaveClass('!text-black');
  });
});
