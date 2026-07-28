import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionInspectorJudgementPanel } from '../SelfInspectionInspectorJudgementPanel';

const values = [
  {
    templateItemId: 'item-1',
    operatorValueSnapshot: '10.5',
    value: '10.1',
    judgementStatus: 'NOT_EVALUATED' as const
  },
  {
    templateItemId: 'item-2',
    operatorValueSnapshot: '20.5',
    value: '20.1',
    judgementStatus: 'NOT_EVALUATED' as const
  }
];

const templateItems = [
  { id: 'item-1', measurementLabel: '外径', measurementPoint: 'A' },
  { id: 'item-2', measurementLabel: '全長', measurementPoint: 'B' }
];

describe('SelfInspectionInspectorJudgementPanel', () => {
  it('shows selection progress and keeps save disabled until every NG is judged', () => {
    const onSelect = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(
      <SelfInspectionInspectorJudgementPanel
        values={values}
        templateItems={templateItems}
        selectedByItemId={{}}
        isSaving={false}
        onSelect={onSelect}
        onSave={onSave}
      />
    );

    expect(screen.getByText('最終判定 0/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最終判定を保存' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: '最終OK' })[0]!);
    expect(onSelect).toHaveBeenCalledWith('item-1', 'FINAL_OK');

    rerender(
      <SelfInspectionInspectorJudgementPanel
        values={values}
        templateItems={templateItems}
        selectedByItemId={{ 'item-1': 'FINAL_OK', 'item-2': 'FINAL_NG' }}
        isSaving={false}
        onSelect={onSelect}
        onSave={onSave}
      />
    );

    expect(screen.getByText('最終判定 2/2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '最終OK' })[0]?.className).toContain(
      'bg-emerald-400'
    );
    expect(screen.getAllByRole('button', { name: '最終NG' })[1]?.className).toContain(
      'bg-red-400'
    );
    fireEvent.click(screen.getByRole('button', { name: '最終判定を保存' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('allows switching one point from final OK to final NG', () => {
    const onSelect = vi.fn();
    render(
      <SelfInspectionInspectorJudgementPanel
        values={[values[0]!]}
        templateItems={templateItems}
        selectedByItemId={{ 'item-1': 'FINAL_OK' }}
        isSaving={false}
        onSelect={onSelect}
        onSave={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '最終NG' }));
    expect(onSelect).toHaveBeenCalledWith('item-1', 'FINAL_NG');
  });
});
