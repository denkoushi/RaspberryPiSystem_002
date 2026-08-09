import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionEntrySlotSelector } from './SelfInspectionEntrySlotSelector';

const slots = [0, 1, 2, 3].map((entryIndex) => ({
  entryIndex,
  entrySlotLabel: `${entryIndex + 1}`,
  entrySlotKind: 'FULL'
}));

describe('SelfInspectionEntrySlotSelector', () => {
  it('renders per-slot states, disables unconfirmed entries, and exposes refresh', () => {
    const onRefresh = vi.fn();
    const onSelect = vi.fn();
    render(
      <SelfInspectionEntrySlotSelector
        slots={slots}
        selectedEntryIndex={0}
        isInspectorMode
        sessionEmployeeGateReady
        inspectorSlotStates={[
          { entryIndex: 0, operatorState: 'confirmed', inspectorState: 'not_started' },
          { entryIndex: 1, operatorState: 'draft', inspectorState: 'not_started' },
          { entryIndex: 2, operatorState: 'confirmed', inspectorState: 'in_progress' },
          { entryIndex: 3, operatorState: 'confirmed', inspectorState: 'complete' }
        ]}
        onSelect={onSelect}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText('未：作業者未確定')).toBeInTheDocument();
    expect(screen.getByText('可：測定可能')).toBeInTheDocument();
    expect(screen.getByText('中：測定中')).toBeInTheDocument();
    expect(screen.getByText('済：測定完了')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2：作業者未確定。作業者が「入力を保存」すると検査できます' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1：作業者確定済み。検査員測定を開始できます' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '状況更新' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '状況更新' }));
    fireEvent.click(screen.getByRole('button', { name: '3：検査員測定中。選択できます' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
