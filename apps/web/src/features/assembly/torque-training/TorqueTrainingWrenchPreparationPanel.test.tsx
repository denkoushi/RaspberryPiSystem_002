import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TorqueTrainingWrenchPreparationPanel } from './TorqueTrainingWrenchPreparationPanel';

const target = {
  nominalDiameter: 'M2.5',
  material: 'SUS304',
  boltLengthMm: '5',
  lowerLimit: '0.35',
  nominalTorque: '0.40',
  upperLimit: '0.45',
  unit: 'N-m'
} as const;

describe('TorqueTrainingWrenchPreparationPanel', () => {
  it('shows the detected serial and all server-provided target values', () => {
    render(
      <TorqueTrainingWrenchPreparationPanel
        target={target}
        wrenchSerialNumber="702902S"
        busy={false}
        settingRegistered={false}
        connectionRetryRequired={false}
        onPrepareAndConnect={vi.fn()}
      />
    );

    expect(screen.getByText('製造番号')).toBeInTheDocument();
    expect(screen.getAllByText('702902S').length).toBeGreaterThan(0);
    expect(screen.getByText('呼び径')).toBeInTheDocument();
    expect(screen.getByText('M2.5')).toBeInTheDocument();
    expect(screen.getByText('SUS304')).toBeInTheDocument();
    expect(screen.getByText('5 mm')).toBeInTheDocument();
    expect(screen.getByText('0.35 N·m')).toBeInTheDocument();
    expect(screen.getByText('0.4 N·m')).toBeInTheDocument();
    expect(screen.getByText('0.45 N·m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' })).toBeEnabled();
  });

  it('treats the button itself as confirmation without an extra checkbox', () => {
    const onPrepareAndConnect = vi.fn();
    render(
      <TorqueTrainingWrenchPreparationPanel
        target={target}
        wrenchSerialNumber="702902S"
        busy={false}
        settingRegistered={false}
        connectionRetryRequired={false}
        onPrepareAndConnect={onPrepareAndConnect}
      />
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' }));
    expect(onPrepareAndConnect).toHaveBeenCalledTimes(1);
  });

  it('shows a retry-only message after the server setting was registered', () => {
    render(
      <TorqueTrainingWrenchPreparationPanel
        target={target}
        wrenchSerialNumber="702902S"
        busy={false}
        settingRegistered
        connectionRetryRequired
        onPrepareAndConnect={vi.fn()}
      />
    );

    expect(screen.getByTestId('torque-training-setting-registered')).toHaveTextContent('設定登録済み');
    expect(screen.getByTestId('torque-training-setting-registered')).toHaveTextContent('接続のみ再試行');
  });

  it('requires a uniquely detected wrench before enabling the button', () => {
    render(
      <TorqueTrainingWrenchPreparationPanel
        target={target}
        wrenchSerialNumber={null}
        busy={false}
        settingRegistered={false}
        connectionRetryRequired={false}
        onPrepareAndConnect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' })).toBeDisabled();
    expect(screen.getByText('torque-agentが物理レンチの製造番号を検出するまでお待ちください。')).toBeInTheDocument();
  });

  it('disables the button and explains when the detected wrench is not assigned', () => {
    render(
      <TorqueTrainingWrenchPreparationPanel
        target={target}
        wrenchSerialNumber="UNKNOWN-1"
        disabledReason="検出した物理レンチ（UNKNOWN-1）はこの訓練版に割り当てられていません。"
        busy={false}
        settingRegistered={false}
        connectionRetryRequired={false}
        onPrepareAndConnect={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('割り当てられていません');
    expect(screen.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' })).toBeDisabled();
  });
});
