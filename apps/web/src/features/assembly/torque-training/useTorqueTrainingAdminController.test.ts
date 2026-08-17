import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTorqueTrainingAdminController } from './useTorqueTrainingAdminController';

import type {
  TorqueTrainingAdminResultApi,
  TorqueTrainingProgramApi,
  TorqueWrenchCapabilityGroupApi,
  TorqueWrenchProfileApi
} from '../../../api/client';

const apiMocks = vi.hoisted(() => ({
  createTorqueTrainingProgram: vi.fn(),
  deactivateTorqueTrainingProgram: vi.fn(),
  excludeTorqueTrainingResult: vi.fn(),
  listTorqueTrainingAdminPrograms: vi.fn(),
  listTorqueTrainingAdminResults: vi.fn(),
  listTorqueWrenchCapabilityGroups: vi.fn(),
  listTorqueWrenches: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listTorqueTrainingAdminPrograms.mockResolvedValue([program()]);
  apiMocks.listTorqueTrainingAdminResults.mockResolvedValue([result()]);
  apiMocks.listTorqueWrenchCapabilityGroups.mockResolvedValue([capabilityGroup]);
  apiMocks.listTorqueWrenches.mockResolvedValue([wrenchProfile]);
  apiMocks.createTorqueTrainingProgram.mockResolvedValue(program());
  apiMocks.reviseTorqueTrainingProgram.mockResolvedValue({});
  apiMocks.deactivateTorqueTrainingProgram.mockResolvedValue(undefined);
  apiMocks.excludeTorqueTrainingResult.mockResolvedValue(undefined);
});

describe('useTorqueTrainingAdminController', () => {
  it('does not load admin data until the dialog is opened', async () => {
    const { result: hook, rerender } = renderHook(
      ({ isOpen }) => useTorqueTrainingAdminController({ isOpen }),
      { initialProps: { isOpen: false } }
    );

    expect(apiMocks.listTorqueTrainingAdminPrograms).not.toHaveBeenCalled();

    rerender({ isOpen: true });
    await waitFor(() => expect(apiMocks.listTorqueTrainingAdminPrograms).toHaveBeenCalledTimes(1));
    expect(hook.current.adminPrograms).toEqual([program()]);
    expect(hook.current.adminResults).toEqual([result()]);
    expect(hook.current.capabilityGroups).toEqual([capabilityGroup]);
    expect(hook.current.wrenchProfiles).toEqual([wrenchProfile]);
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

  it('requires a revision target and omits code from a revision payload', async () => {
    const { result: hook } = renderHook(() => useTorqueTrainingAdminController({ isOpen: false }));

    await act(async () => {
      await hook.current.submitProgram(true);
    });
    expect(apiMocks.reviseTorqueTrainingProgram).not.toHaveBeenCalled();
    expect(hook.current.error).toBe('版を追加するメニューを選択してください。');

    act(() => {
      hook.current.setRevisionProgramId('program-1');
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
