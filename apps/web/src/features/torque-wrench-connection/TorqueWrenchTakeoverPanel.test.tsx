import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TorqueWrenchTakeoverPanel,
  TORQUE_TAKEOVER_CONFIRMATION_ARM_DELAY_MS
} from './TorqueWrenchTakeoverPanel';

describe('TorqueWrenchTakeoverPanel', () => {
  afterEach(() => vi.useRealTimers());

  it('requires the delayed checkbox before the final takeover action', async () => {
    vi.useFakeTimers();
    const onTakeover = vi.fn().mockResolvedValue(undefined);
    render(
      <TorqueWrenchTakeoverPanel
        targetKind="training"
        owner={{ clientDeviceName: 'StoneBase', clientDeviceLocation: '1F' }}
        onTakeover={onTakeover}
      />
    );

    expect(screen.getByText('使用機能: 締付トルク訓練')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '現物が手元にあるため引き継ぐ' }));
    const checkbox = screen.getByRole('checkbox');
    const takeover = screen.getByRole('button', { name: '確認して接続権を引き継ぐ' });
    expect(checkbox).toBeDisabled();
    expect(takeover).toBeDisabled();

    await vi.advanceTimersByTimeAsync(TORQUE_TAKEOVER_CONFIRMATION_ARM_DELAY_MS);
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(takeover).toBeEnabled();
    fireEvent.click(takeover);
    expect(onTakeover).toHaveBeenCalledTimes(1);
  });
});
