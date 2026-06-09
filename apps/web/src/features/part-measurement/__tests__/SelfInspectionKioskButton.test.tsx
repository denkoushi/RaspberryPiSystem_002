import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SelfInspectionKioskButton } from '../SelfInspectionKioskButton';

describe('SelfInspectionKioskButton', () => {
  it('reflects highlighted prop when enabled', () => {
    render(<SelfInspectionKioskButton highlighted>入力を保存</SelfInspectionKioskButton>);
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).toContain('ring-sky-400');
  });

  it('does not highlight when disabled even if highlighted prop is true', () => {
    render(
      <SelfInspectionKioskButton highlighted disabled>
        入力を保存
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).not.toContain('ring-sky-400');
  });

  it('supports actionCompact size for save and complete buttons', () => {
    render(
      <SelfInspectionKioskButton size="actionCompact" highlighted>
        入力を保存
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).toContain('min-h-8');
    expect(button.className).toContain('text-[15px]');
  });

  it('mirrors session page wiring: save and complete highlight only when enabled', () => {
    const saveEnabled = true;
    const completeEnabled = false;

    render(
      <div data-self-inspection-session-actions>
        <SelfInspectionKioskButton disabled={!saveEnabled} highlighted={saveEnabled}>
          入力を保存
        </SelfInspectionKioskButton>
        <SelfInspectionKioskButton disabled={!completeEnabled} highlighted={completeEnabled}>
          自主検査を完了
        </SelfInspectionKioskButton>
      </div>
    );

    expect(screen.getByRole('button', { name: '入力を保存' }).className).toContain('ring-sky-400');
    expect(screen.getByRole('button', { name: '自主検査を完了' }).className).not.toContain(
      'ring-sky-400'
    );
  });
});
