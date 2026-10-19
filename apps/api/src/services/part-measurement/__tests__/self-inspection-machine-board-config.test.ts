import { describe, expect, it } from 'vitest';

import {
  resolveSelfInspectionMachineBoardConfig,
  resolveSelfInspectionMachineBoardTargetMode,
  sanitizeSelfInspectionMachineBoardMaxAutoMachines,
} from '../self-inspection-machine-board-config.js';

describe('self-inspection-machine-board-config', () => {
  it('treats missing targetMode as manual_machine_name', () => {
    expect(resolveSelfInspectionMachineBoardTargetMode({})).toBe('manual_machine_name');
  });

  it('resolves manual config with machineName', () => {
    const resolved = resolveSelfInspectionMachineBoardConfig({
      machineName: ' L300KP ',
      deviceScopeKey: '第2工場 - kensakuMain',
    });
    expect(resolved).toEqual({
      targetMode: 'manual_machine_name',
      machineName: 'L300KP',
      deviceScopeKey: '第2工場 - kensakuMain',
    });
  });

  it('resolves auto config with resourceCds', () => {
    const resolved = resolveSelfInspectionMachineBoardConfig({
      targetMode: 'auto_from_leaderboard_status',
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: [' RD01 ', 'RD02'],
      maxAutoMachines: 99,
    });
    expect(resolved).toEqual({
      targetMode: 'auto_from_leaderboard_status',
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01', 'RD02'],
      maxAutoMachines: 20,
    });
  });

  it('resolves kiosk_active_sessions without carrying legacy targeting fields', () => {
    const resolved = resolveSelfInspectionMachineBoardConfig({
      targetMode: 'kiosk_active_sessions',
      machineName: 'ignored-machine',
      deviceScopeKey: 'ignored-scope',
      resourceCds: ['R1'],
      maxAutoMachines: 20,
    });

    expect(resolved).toEqual({ targetMode: 'kiosk_active_sessions' });
  });

  it('does not silently treat an unknown target mode as manual', () => {
    expect(() =>
      resolveSelfInspectionMachineBoardTargetMode({ targetMode: 'unknown-mode' })
    ).toThrow('Unsupported self-inspection machine board targetMode');
  });

  it('caps maxAutoMachines to configured maximum', () => {
    expect(sanitizeSelfInspectionMachineBoardMaxAutoMachines(0)).toBe(1);
    expect(sanitizeSelfInspectionMachineBoardMaxAutoMachines(3)).toBe(3);
    expect(sanitizeSelfInspectionMachineBoardMaxAutoMachines(99)).toBe(20);
  });
});
