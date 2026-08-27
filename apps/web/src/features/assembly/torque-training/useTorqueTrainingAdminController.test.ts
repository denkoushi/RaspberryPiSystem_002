import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTorqueTrainingAdminController } from './useTorqueTrainingAdminController';

import type {
  TorqueTrainingAdminResultApi,
  TorqueTrainingProgramApi,
  TorqueTrainingProgramVersionApi,
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchProfileApi
} from '../../../api/client';

const apiMocks = vi.hoisted(() => ({
  createTorqueTrainingProgram: vi.fn(),
  createTorqueTrainingSettingsProgram: vi.fn(),
  deactivateTorqueTrainingProgram: vi.fn(),
  deactivateTorqueTrainingSettingsProgram: vi.fn(),
  excludeTorqueTrainingResult: vi.fn(),
  excludeTorqueTrainingSettingsResult: vi.fn(),
  getTorqueTrainingSettingsSnapshot: vi.fn(),
  listTorqueTrainingAdminPrograms: vi.fn(),
  listTorqueTrainingAdminResults: vi.fn(),
  listTorqueWrenchCapabilityGroups: vi.fn(),
  listTorqueWrenches: vi.fn(),
  reviseTorqueTrainingSettingsProgram: vi.fn(),
  reviseTorqueTrainingProgram: vi.fn()
}));

vi.mock('../../../api/client', () => apiMocks);

const program = (overrides: Partial<TorqueTrainingProgramApi> = {}) => ({
  id: 'program-1',
  code: 'M8-001',
  isActive: true,
  currentVersion: 1,
  versions: [],
  ...overrides
}) as TorqueTrainingProgramApi;

const version = (
  overrides: Partial<TorqueTrainingProgramVersionApi> = {}
): TorqueTrainingProgramVersionApi => ({
  id: 'version-1',
  version: 1,
  displayName: 'M8 training',
  nominalDiameter: 'M8',
  boltLengthMm: '25',
  material: 'SUS304',
  strengthClass: 'A2-70',
  capabilityGroupId: 'group-1',
  nominalTorque: '12.5',
  lowerLimit: '10',
  upperLimit: '15',
  unit: 'N-m',
  jigConditionCode: 'JIG-A',
  conditionFingerprint: 'fingerprint-v1',
  torqueWrenchProfiles: [{ id: 'wrench-1', serialNumber: 'TW-001' }],
  setupState: 'READY',
  setupStateReason: null,
  ...overrides
});

const result = (overrides: Partial<TorqueTrainingAdminResultApi> = {}) => ({
  id: 'session-1',
  employeeCode: 'E001',
  employeeName: '山田太郎',
  programCode: 'M8-001',
  programVersion: 1,
  conditionFingerprint: 'fingerprint',
  status: 'COMPLETED',
  excludedAt: null,
  exclusionReason: null,
  completedAt: '2026-08-17T00:00:00.000Z',
  metrics: {
    attemptCount: 5,
    passRate: 1,
    meanAbsoluteErrorPercent: 1.2,
    variationPercent: 0.4
  },
  ...overrides
}) as TorqueTrainingAdminResultApi;

const capabilityGroup = { id: 'group-1', name: 'M8', nominalDiameter: 'M8', boltLengthMm: '25', material: 'SUS', strengthClass: 'A2-70', isActive: true, models: [] } as TorqueWrenchCapabilityGroupApi;
const wrenchProfile = { id: 'wrench-1', serialNumber: 'TW-001' } as TorqueWrenchProfileApi;

const settingsSnapshot = {
  programs: [program()],
  results: [result()],
  capabilityGroups: [capabilityGroup],
  wrenchProfiles: [wrenchProfile]
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listTorqueTrainingAdminPrograms.mockResolvedValue([program()]);
  apiMocks.listTorqueTrainingAdminResults.mockResolvedValue([result()]);
  apiMocks.listTorqueWrenchCapabilityGroups.mockResolvedValue([capabilityGroup]);
  apiMocks.listTorqueWrenches.mockResolvedValue([wrenchProfile]);
  apiMocks.createTorqueTrainingProgram.mockResolvedValue(program());
  apiMocks.createTorqueTrainingSettingsProgram.mockResolvedValue(program());
  apiMocks.reviseTorqueTrainingProgram.mockResolvedValue({});
  apiMocks.reviseTorqueTrainingSettingsProgram.mockResolvedValue({});
  apiMocks.deactivateTorqueTrainingProgram.mockResolvedValue(undefined);
  apiMocks.deactivateTorqueTrainingSettingsProgram.mockResolvedValue(undefined);
  apiMocks.excludeTorqueTrainingResult.mockResolvedValue(undefined);
  apiMocks.excludeTorqueTrainingSettingsResult.mockResolvedValue(undefined);
  apiMocks.getTorqueTrainingSettingsSnapshot.mockResolvedValue(settingsSnapshot);
});

describe('useTorqueTrainingAdminController', () => {
  it('authenticates kiosk settings with a snapshot and uses the same in-memory PIN for writes', async () => {
    const onProgramsChanged = vi.fn(async () => undefined);
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({
      isOpen: false,
      accessMode: 'kiosk',
      onProgramsChanged
    }));

    let authenticated = false;
    await act(async () => {
      authenticated = await hook.current.authenticateSettingsAccessPassword('2520');
    });

    expect(authenticated).toBe(true);
    expect(apiMocks.getTorqueTrainingSettingsSnapshot).toHaveBeenCalledWith('2520');
    expect(hook.current.settingsAuthenticated).toBe(true);
    expect(hook.current.adminPrograms).toEqual(settingsSnapshot.programs);

    act(() => hook.current.setExclusionReason('session-1', '  計測不備  '));
    await act(async () => {
      await hook.current.excludeResult('session-1');
    });

    expect(apiMocks.excludeTorqueTrainingSettingsResult).toHaveBeenCalledWith(
      'session-1',
      '2520',
      '計測不備'
    );
    expect(apiMocks.excludeTorqueTrainingResult).not.toHaveBeenCalled();
    expect(onProgramsChanged).not.toHaveBeenCalled();

    act(() => hook.current.clearSettingsAccess());
    expect(hook.current.settingsAuthenticated).toBe(false);
    expect(hook.current.adminPrograms).toEqual([]);
  });

  it('keeps a failed kiosk PIN out of the controller authorization state', async () => {
    apiMocks.getTorqueTrainingSettingsSnapshot.mockRejectedValueOnce(new Error('操作時パスワードが違います。'));
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({
      isOpen: false,
      accessMode: 'kiosk'
    }));

    let authenticated = true;
    await act(async () => {
      authenticated = await hook.current.authenticateSettingsAccessPassword('0000');
    });

    expect(authenticated).toBe(false);
    expect(hook.current.settingsAuthenticated).toBe(false);
    expect(hook.current.error).toBe('操作時パスワードが違います。');
  });

  it('does not load admin data until the dialog is opened', async () => {
    const { result: hook, rerender } = renderHook(
      ({ isOpen }) => useTorqueTrainingAdminController({ isOpen }),
      { initialProps: { isOpen: false } }
    );

    expect(apiMocks.listTorqueTrainingAdminPrograms).not.toHaveBeenCalled();

    rerender({ isOpen: true });
    await waitFor(() => {
      expect(apiMocks.listTorqueTrainingAdminPrograms).toHaveBeenCalledTimes(1);
      expect(hook.current.adminPrograms).toEqual([program()]);
      expect(hook.current.adminResults).toEqual([result()]);
      expect(hook.current.capabilityGroups).toEqual([capabilityGroup]);
      expect(hook.current.wrenchProfiles).toEqual([wrenchProfile]);
    });
  });

  it('filters results through the controller query state', async () => {
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: true }));
    await waitFor(() => expect(hook.current.adminResults).toHaveLength(1));

    act(() => hook.current.setResultQuery('unknown'));
    expect(hook.current.filteredAdminResults).toEqual([]);

    act(() => hook.current.setResultQuery(' E001 '));
    expect(hook.current.filteredAdminResults).toEqual([result()]);
  });

  it('creates a program, refreshes the admin list, and notifies the normal selector', async () => {
    const onProgramsChanged = vi.fn(async () => undefined);
    const { result: hook } = renderHook(() =>
      useTorqueTrainingAdminController({ isOpen: false, onProgramsChanged })
    );

    act(() => {
      hook.current.updateProgramForm('code', 'M8-002');
      hook.current.updateProgramForm('boltLengthMm', '30');
      hook.current.updateProgramForm('nominalTorque', '20');
      hook.current.updateProgramForm('lowerLimit', '18');
      hook.current.updateProgramForm('upperLimit', '22');
    });

    await act(async () => {
      await hook.current.submitProgram(false);
    });

    expect(apiMocks.createTorqueTrainingProgram).toHaveBeenCalledWith(expect.objectContaining({
      code: 'M8-002',
      boltLengthMm: 30,
      nominalTorque: 20,
      lowerLimit: 18,
      upperLimit: 22
    }));
    expect(apiMocks.listTorqueTrainingAdminPrograms).toHaveBeenCalledTimes(1);
    expect(onProgramsChanged).toHaveBeenCalledTimes(1);
    expect(hook.current.programForm.code).toBe('');
    expect(hook.current.message).toBe('訓練メニューを追加しました。');
  });

  it('prefills the current version for a revision and clears the form when selection is cleared', async () => {
    const currentProgram = program({
      currentVersion: 2,
      versions: [
        version({ id: 'version-1', version: 1, displayName: '旧版' }),
        version({
          id: 'version-2',
          version: 2,
          displayName: '新版',
          boltLengthMm: '30',
          capabilityGroupId: 'group-2',
          nominalTorque: '20',
          torqueWrenchProfiles: [{ id: 'wrench-2', serialNumber: 'TW-002' }]
        })
      ]
    });
    apiMocks.listTorqueTrainingAdminPrograms.mockResolvedValueOnce([currentProgram]);

    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: true }));
    await waitFor(() => expect(hook.current.adminPrograms).toEqual([currentProgram]));

    act(() => hook.current.selectRevisionProgram('program-1'));

    expect(hook.current.revisionProgramId).toBe('program-1');
    expect(hook.current.programForm).toEqual({
      code: 'M8-001',
      displayName: '新版',
      nominalDiameter: 'M8',
      boltLengthMm: '30',
      material: 'SUS304',
      strengthClass: 'A2-70',
      capabilityGroupId: 'group-2',
      nominalTorque: '20',
      lowerLimit: '10',
      upperLimit: '15',
      unit: 'N-m',
      jigConditionCode: 'JIG-A',
      torqueWrenchProfileIds: ['wrench-2']
    });

    act(() => hook.current.selectRevisionProgram(''));

    expect(hook.current.revisionProgramId).toBe('');
    expect(hook.current.programForm).toEqual({
      code: '',
      displayName: '',
      nominalDiameter: '',
      boltLengthMm: '',
      material: '',
      strengthClass: '',
      capabilityGroupId: '',
      nominalTorque: '',
      lowerLimit: '',
      upperLimit: '',
      unit: 'N-m',
      jigConditionCode: '',
      torqueWrenchProfileIds: []
    });
  });

  it('requires a revision target and omits code from a revision payload', async () => {
    apiMocks.listTorqueTrainingAdminPrograms.mockResolvedValueOnce([
      program({ versions: [version()] })
    ]);
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: true }));
    await waitFor(() => expect(hook.current.adminPrograms).toHaveLength(1));

    await act(async () => {
      await hook.current.submitProgram(true);
    });
    expect(apiMocks.reviseTorqueTrainingProgram).not.toHaveBeenCalled();
    expect(hook.current.error).toBe('版を追加するメニューを選択してください。');

    act(() => {
      hook.current.selectRevisionProgram('program-1');
      hook.current.updateProgramForm('code', 'IGNORED-CODE');
      hook.current.updateProgramForm('nominalTorque', '21');
    });
    await act(async () => {
      await hook.current.submitProgram(true);
    });

    expect(apiMocks.reviseTorqueTrainingProgram).toHaveBeenCalledWith(
      'program-1',
      expect.objectContaining({ nominalTorque: 21 })
    );
    expect(apiMocks.reviseTorqueTrainingProgram.mock.calls[0][1]).not.toHaveProperty('code');
  });

  it('does not enable revision for an inactive, unknown, or versionless target', async () => {
    apiMocks.listTorqueTrainingAdminPrograms.mockResolvedValueOnce([
      program({ id: 'inactive-program', isActive: false, versions: [version()] }),
      program({ id: 'versionless-program', versions: [] })
    ]);
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: true }));
    await waitFor(() => expect(hook.current.adminPrograms).toHaveLength(2));

    act(() => hook.current.selectRevisionProgram('inactive-program'));
    expect(hook.current.revisionProgramId).toBe('');

    act(() => hook.current.selectRevisionProgram('versionless-program'));
    expect(hook.current.revisionProgramId).toBe('');

    act(() => hook.current.selectRevisionProgram('unknown-program'));
    expect(hook.current.revisionProgramId).toBe('');
    expect(hook.current.programForm).toEqual({
      code: '',
      displayName: '',
      nominalDiameter: '',
      boltLengthMm: '',
      material: '',
      strengthClass: '',
      capabilityGroupId: '',
      nominalTorque: '',
      lowerLimit: '',
      upperLimit: '',
      unit: 'N-m',
      jigConditionCode: '',
      torqueWrenchProfileIds: []
    });
  });

  it('deactivates with a trimmed reason and notifies the normal selector', async () => {
    const onProgramsChanged = vi.fn(async () => undefined);
    const { result: hook } = renderHook(() =>
      useTorqueTrainingAdminController({ isOpen: false, onProgramsChanged })
    );

    await act(async () => {
      await hook.current.deactivate('program-1', '  obsolete  ');
    });

    expect(apiMocks.deactivateTorqueTrainingProgram).toHaveBeenCalledWith('program-1', 'obsolete');
    expect(onProgramsChanged).toHaveBeenCalledTimes(1);
    expect(hook.current.message).toBe('訓練メニューを停止しました。');
  });

  it('excludes a result using its current reason and clears that reason after success', async () => {
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: false }));

    act(() => hook.current.setExclusionReason('session-1', '  計測不備  '));
    await act(async () => {
      await hook.current.excludeResult('session-1');
    });

    expect(apiMocks.excludeTorqueTrainingResult).toHaveBeenCalledWith('session-1', '計測不備');
    expect(apiMocks.listTorqueTrainingAdminResults).toHaveBeenCalledTimes(1);
    expect(hook.current.exclusionReasons['session-1']).toBe('');
    expect(hook.current.message).toBe('訓練実績を集計対象外にしました。');
  });

  it('keeps the dialog actionable and exposes an error when a write fails', async () => {
    apiMocks.createTorqueTrainingProgram.mockRejectedValueOnce(new Error('保存失敗'));
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: false }));

    await act(async () => {
      await hook.current.submitProgram(false);
    });

    expect(hook.current.error).toBe('保存失敗');
    expect(hook.current.adminBusy).toBe(false);
  });
});
