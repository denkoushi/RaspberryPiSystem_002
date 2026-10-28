import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { toggleHydraulicOilTarget } from '../visualization-dashboards/visualizationDashboardFormModel';

import { HydraulicOilExchangeMachinePicker } from './HydraulicOilExchangeMachinePicker';

vi.mock('../../../api/hooks/tools', () => ({
  useMachines: () => ({
    data: [
      { equipmentManagementNumber: 'M1', name: 'ｌａｔｈｅ-１', operatingStatus: '停止中' },
      { equipmentManagementNumber: 'M2', name: 'ｍｃ-２', operatingStatus: '稼働中' },
      { equipmentManagementNumber: 'R1', name: 'ＲＯＢＯＤＲＩＬＬ', operatingStatus: '稼働中' },
      { equipmentManagementNumber: 'R2', name: 'ﾛﾎﾞﾄﾞﾘﾙ', operatingStatus: '稼働中' },
      { equipmentManagementNumber: 'R3', name: 'robo drill', operatingStatus: '稼働中' },
    ], isLoading: false, isError: false,
  }),
}));

function Harness() {
  const [config, setConfig] = useState(JSON.stringify({ csvDashboardId: 'csv', extra: { keep: true }, targetEquipmentNumbers: ['missing'] }));
  return <><HydraulicOilExchangeMachinePicker config={config} onChange={setConfig} /><output data-testid="config">{config}</output></>;
}

describe('hydraulic oil machine picker', () => {
  it('toggles targets, preserves unknown keys and missing numbers, and sorts running machines first', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: '対象の加工機' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent('MC-2');
    expect(buttons[1]).toHaveTextContent('LATHE-1');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('2 台選択')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toEqual({ csvDashboardId: 'csv', extra: { keep: true }, targetEquipmentNumbers: ['missing', 'M2'] });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[2]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('0 台選択')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('config').textContent!).targetEquipmentNumbers).toEqual([]);
  });
  it('disables the picker for invalid JSON', () => {
    render(<HydraulicOilExchangeMachinePicker config="{" onChange={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(toggleHydraulicOilTarget('{', 'M1')).toBe('{');
  });
  it('preserves config when selection is full and allows deselection', () => {
    const targets = Array.from({ length: 200 }, (_, i) => `M${i}`);
    const config = JSON.stringify({ targetEquipmentNumbers: targets, extra: true });
    expect(JSON.parse(toggleHydraulicOilTarget(config, 'new')).targetEquipmentNumbers).toHaveLength(200);
    const result = JSON.parse(toggleHydraulicOilTarget(config, 'M0'));
    expect(result.targetEquipmentNumbers).toHaveLength(199);
    expect(result.extra).toBe(true);
  });
});
