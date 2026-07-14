import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingValuePanel } from '../InspectionDrawingValuePanel';

import type { InspectionDrawingPoint } from '../types';

function makePoint(overrides: Partial<InspectionDrawingPoint> = {}): InspectionDrawingPoint {
  return {
    id: 'p1',
    markerNo: 1,
    name: '幾何公差',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: '10',
    lowerToleranceRaw: '-0.1',
    upperToleranceRaw: '0.1',
    testValue: '',
    ...overrides
  };
}

describe('InspectionDrawingValuePanel', () => {
  it('uses enlarged tolerance text and horizontal inputs for self_inspection_options with dropdown', () => {
    const { container } = render(
      <InspectionDrawingValuePanel
        point={makePoint()}
        valueInputMode="self_inspection_options"
        onValueChange={() => undefined}
      />
    );

    const tolerance = container.querySelector('.text-2xl');
    expect(tolerance).toBeTruthy();
    expect(tolerance?.textContent).toContain('基準 10 / -0.1〜+0.1');

    expect(screen.getByText('測定値選択')).toBeInTheDocument();
    expect(screen.queryByText('候補から選択')).toBeNull();
    expect(screen.queryByText(/候補（刻み/)).toBeNull();
    expect(screen.getByText('測定値（直接入力）')).toBeInTheDocument();
    expect(container.querySelector('.grid.grid-cols-2')).toBeTruthy();
  });

  it('uses the same measurement selector title for dimension hundredths dropdown', () => {
    render(
      <InspectionDrawingValuePanel
        point={makePoint({ name: '外径', nominalRaw: '100', lowerToleranceRaw: '-0.05', upperToleranceRaw: '0.05' })}
        valueInputMode="self_inspection_options"
        onValueChange={() => undefined}
      />
    );

    expect(screen.getByText('測定値選択')).toBeInTheDocument();
    expect(screen.queryByText(/0\.1候補/)).toBeNull();
    expect(screen.queryByText(/候補（刻み/)).toBeNull();
  });

  it('shows invalid status via shared measurement point input status helper', () => {
    render(
      <InspectionDrawingValuePanel
        point={makePoint({ testValue: 'abc' })}
        valueInputMode="self_inspection_options"
        onValueChange={() => undefined}
      />
    );

    expect(screen.getByText('不正')).toBeInTheDocument();
  });

  it('keeps vertical layout for free_only mode', () => {
    const { container } = render(
      <InspectionDrawingValuePanel
        point={makePoint()}
        valueInputMode="free_only"
        onValueChange={() => undefined}
      />
    );

    expect(container.querySelector('.text-2xl')).toBeNull();
    expect(container.querySelector('.grid.grid-cols-2')).toBeNull();
    expect(screen.getByText('測定値')).toBeInTheDocument();
  });

  it('uses OK/NG buttons only for a pipe-thread judgement and commits NG directly', () => {
    const onValueChange = vi.fn();
    const onCommitValue = vi.fn();
    render(
      <InspectionDrawingValuePanel
        point={makePoint({
          name: 'ネジ穴深さ',
          threadNominal: '管用',
          valueKind: 'judgement',
          nominalRaw: '',
          lowerToleranceRaw: '',
          upperToleranceRaw: ''
        })}
        valueInputMode="self_inspection_options"
        onValueChange={onValueChange}
        onCommitValue={onCommitValue}
      />
    );

    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NG' })).toBeInTheDocument();
    expect(screen.queryByText('測定値選択')).toBeNull();
    expect(screen.queryByText('測定値（直接入力）')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'NG' }));
    expect(onValueChange).toHaveBeenCalledWith('FAIL');
    expect(onCommitValue).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'FAIL', source: 'dropdown' })
    );
  });
});
