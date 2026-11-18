import { describe, expect, it } from 'vitest';

import {
  formatTorqueTrainingBoltLength,
  formatTorqueTrainingUnit,
  formatTorqueTrainingValue,
  presentTorqueTrainingSetupReason
} from './torqueTrainingWrenchPreparation';

describe('torqueTrainingWrenchPreparation presentation helpers', () => {
  it('normalizes the torque unit without changing the numeric value', () => {
    expect(formatTorqueTrainingValue('0.50', 'N-m')).toBe('0.5 N·m');
    expect(formatTorqueTrainingValue('13.00', 'Nm')).toBe('13 N·m');
    expect(formatTorqueTrainingValue('1.60', 'kgf·cm')).toBe('1.6 kgf·cm');
  });

  it('renders the 2D bolt length in millimetres', () => {
    expect(formatTorqueTrainingBoltLength('5')).toBe('5 mm');
    expect(formatTorqueTrainingBoltLength(null)).toBe('-');
    expect(formatTorqueTrainingUnit('N-m')).toBe('N·m');
  });

  it('turns readiness codes into a kiosk-readable reason', () => {
    expect(presentTorqueTrainingSetupReason('NO_ASSIGNED_WRENCH')).toBe('対応レンチ未登録');
    expect(presentTorqueTrainingSetupReason('CALIBRATION_EXPIRED')).toBe('校正期限が切れています');
    expect(presentTorqueTrainingSetupReason('future_reason')).toBe('future_reason');
    expect(presentTorqueTrainingSetupReason(null)).toBeNull();
  });
});
