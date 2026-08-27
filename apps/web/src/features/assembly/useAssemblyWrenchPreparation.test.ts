import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  confirmAssemblyTorqueWrench,
  listCompatibleTorqueWrenchesForSession,
  listCurrentTorqueWrenchConfirmations
} from '../../api/client';

import {
  requiresFreshAssemblyWrenchConfirmation,
  useAssemblyWrenchPreparation
} from './useAssemblyWrenchPreparation';

import type { TorqueWrenchProfileApi } from '../../api/domains/torque-wrenches';

vi.mock('../../api/client', () => ({
  confirmAssemblyTorqueWrench: vi.fn(),
  listCompatibleTorqueWrenchesForSession: vi.fn(),
  listCurrentTorqueWrenchConfirmations: vi.fn()
}));

const mockConfirm = vi.mocked(confirmAssemblyTorqueWrench);
const mockListCompatible = vi.mocked(listCompatibleTorqueWrenchesForSession);
const mockListCurrent = vi.mocked(listCurrentTorqueWrenchConfirmations);

function profile(): TorqueWrenchProfileApi {
  return {
    id: 'profile-bolt',
    modelId: 'model-bolt',
    serialNumber: 'TW-BOLT-01',
    measuringInstrument: {
      id: 'instrument-1',
      name: 'レンチ',
      managementNumber: 'M-1',
      storageLocation: null,
      calibrationExpiryDate: null,
      status: 'AVAILABLE'
    },
    model: {
      id: 'model-bolt',
      manufacturer: 'メーカー',
      modelNumber: 'CEM20N3X10D-BTLA',
      torqueMinNm: '1',
      torqueMaxNm: '20',
      resolutionNm: null,
      communicationType: 'bluetooth',
      outputProfile: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY',
      isActive: true
    },
    settingHistories: []
  };
}

function options(
  connectionRef: { current: { acquire: ReturnType<typeof vi.fn>; clearError: ReturnType<typeof vi.fn> } | null },
  sessionId: string,
  currentTemplateBoltId: string
) {
  return {
    sessionId,
    currentTemplateBoltId,
    sessionActive: true,
    traceabilityRequired: true,
    connectionRef,
    onMessage: vi.fn()
  };
}

describe('useAssemblyWrenchPreparation', () => {
  it('classifies fenced and expired agent outcomes as requiring a fresh confirmation', () => {
    expect(requiresFreshAssemblyWrenchConfirmation({ state: 'fenced' })).toBe(true);
    expect(requiresFreshAssemblyWrenchConfirmation({ state: 'expired' })).toBe(true);
    expect(requiresFreshAssemblyWrenchConfirmation({ lastError: 'TORQUE_WRENCH_LEASE_EXPIRED' })).toBe(true);
    expect(requiresFreshAssemblyWrenchConfirmation({ response: { data: { code: 'CONFIRMATION_STALE' } } })).toBe(true);
    expect(requiresFreshAssemblyWrenchConfirmation(new TypeError('connection refused'))).toBe(false);
  });

  it('keeps one BOLT confirmation for a same-condition next marker but drops it on a new session', async () => {
    const connectionRef = {
      current: {
        acquire: vi.fn().mockResolvedValue({
          ok: true,
          ready: false,
          state: 'owned_by_self',
          owner: null,
          bound: true,
          leaseOwned: true,
          bluetoothPowered: false,
          hidExclusive: false,
          lastError: null
        }),
        clearError: vi.fn()
      }
    };
    mockConfirm.mockReset();
    mockListCompatible.mockReset();
    mockListCurrent.mockReset();
    mockListCompatible.mockResolvedValue([{ profile: profile(), conditionFingerprint: 'same-condition' }]);
    mockListCurrent.mockResolvedValue([]);
    mockConfirm.mockResolvedValue({
      id: 'confirmation-bolt',
      torqueWrenchProfileId: 'profile-bolt',
      settingHistoryId: null,
      settingVerificationMode: 'BOLT_CONDITION_ONLY'
    });

    const { result, rerender } = renderHook(
      ({ sessionId, currentTemplateBoltId }: { sessionId: string; currentTemplateBoltId: string }) =>
        useAssemblyWrenchPreparation(options(connectionRef, sessionId, currentTemplateBoltId)),
      { initialProps: { sessionId: 'session-a', currentTemplateBoltId: 'bolt-a' } }
    );

    await waitFor(() => expect(result.current.selectedProfileId).toBe('profile-bolt'));
    await act(async () => {
      await result.current.connectBoltConditionWrench();
    });
    expect(result.current.confirmation).toMatchObject({
      id: 'confirmation-bolt',
      sessionId: 'session-a'
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockListCurrent).not.toHaveBeenCalled();

    rerender({ sessionId: 'session-a', currentTemplateBoltId: 'bolt-b' });
    await waitFor(() => expect(result.current.confirmation?.id).toBe('confirmation-bolt'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    rerender({ sessionId: 'session-b', currentTemplateBoltId: 'bolt-a' });
    expect(result.current.confirmation).toBeNull();
    await waitFor(() => expect(result.current.confirmation).toBeNull());
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });
});
