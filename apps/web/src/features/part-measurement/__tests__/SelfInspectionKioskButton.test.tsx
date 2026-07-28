import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionKioskButton } from '../SelfInspectionKioskButton';

describe('SelfInspectionKioskButton', () => {
  it('reflects highlighted prop when enabled', () => {
    render(<SelfInspectionKioskButton highlighted>入力を保存</SelfInspectionKioskButton>);
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).toContain('bg-emerald-500');
  });

  it('does not highlight when disabled even if highlighted prop is true', () => {
    render(
      <SelfInspectionKioskButton highlighted disabled>
        入力を保存
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).not.toContain('bg-emerald-500');
  });

  it('supports actionCompact size for save and complete buttons', () => {
    render(
      <SelfInspectionKioskButton size="actionCompact" highlighted>
        入力を保存
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '入力を保存' });
    expect(button.className).toContain('min-h-6');
    expect(button.className).toContain('text-[15px]');
    expect(button.className).toContain('bg-emerald-500');
  });

  it('applies inactive tone without disabling the button', () => {
    const onClick = vi.fn();
    render(
      <SelfInspectionKioskButton tone="inactive" onClick={onClick}>
        手元カメラ OFF
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '手元カメラ OFF' });
    expect(button).not.toBeDisabled();
    expect(button.className).toContain('bg-white/5');
    expect(button.className).toContain('text-white/40');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses a visible selected style when pressed', () => {
    render(<SelfInspectionKioskButton pressed>1件目</SelfInspectionKioskButton>);
    const button = screen.getByRole('button', { name: '1件目' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.className).toContain('bg-cyan-400');
    expect(button.className).toContain('ring-2');
  });

  it('uses semantic success and danger colors for final judgements', () => {
    render(
      <>
        <SelfInspectionKioskButton tone="success" pressed>
          最終OK
        </SelfInspectionKioskButton>
        <SelfInspectionKioskButton tone="danger" pressed>
          最終NG
        </SelfInspectionKioskButton>
      </>
    );
    expect(screen.getByRole('button', { name: '最終OK' }).className).toContain(
      'bg-emerald-400'
    );
    expect(screen.getByRole('button', { name: '最終NG' }).className).toContain(
      'bg-red-400'
    );
  });

  it('keeps disabled styling ahead of pressed semantic styling', () => {
    render(
      <SelfInspectionKioskButton tone="danger" pressed disabled>
        最終NG
      </SelfInspectionKioskButton>
    );
    const button = screen.getByRole('button', { name: '最終NG' });
    expect(button.className).not.toContain('bg-red-400');
    expect(button.className).toContain('opacity-40');
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

    expect(screen.getByRole('button', { name: '入力を保存' }).className).toContain('bg-emerald-500');
    expect(screen.getByRole('button', { name: '自主検査を完了' }).className).not.toContain(
      'bg-emerald-500'
    );
  });
});
