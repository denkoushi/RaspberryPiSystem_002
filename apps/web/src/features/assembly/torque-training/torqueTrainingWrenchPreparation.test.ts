import { describe, expect, it } from 'vitest';

import {
  formatTorqueTrainingBoltLength,
  formatTorqueTrainingUnit,
  formatTorqueTrainingValue,
  preparationTargetRows,
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

  it('keeps target rows ordered for the preparation card', () => {
    expect(preparationTargetRows({
      nominalDiameter: 'M2.5',
      material: 'SUS304',
      boltLengthMm: '5',
      lowerLimit: '0.35',
      nominalTorque: '0.40',
      upperLimit: '0.45',
      unit: 'N-m'
    })).toEqual([
      { key: 'nominalDiameter', label: '呼び径', value: 'M2.5' },
      { key: 'material', label: '材質', value: 'SUS304' },
      { key: 'boltLengthMm', label: '首下長さ', value: '5 mm' },
      { key: 'lowerLimit', label: '下限', value: '0.35 N·m' },
      { key: 'nominalTorque', label: '目標', value: '0.4 N·m' },
      { key: 'upperLimit', label: '上限', value: '0.45 N·m' }
    ]);
  });

  it('turns readiness codes into a kiosk-readable reason', () => {
    expect(presentTorqueTrainingSetupReason('NO_ASSIGNED_WRENCH')).toBe('対応レンチ未登録');
    expect(presentTorqueTrainingSetupReason('CALIBRATION_EXPIRED')).toBe('校正期限が切れています');
    expect(presentTorqueTrainingSetupReason('future_reason')).toBe('future_reason');
    expect(presentTorqueTrainingSetupReason(null)).toBeNull();
  });
});
