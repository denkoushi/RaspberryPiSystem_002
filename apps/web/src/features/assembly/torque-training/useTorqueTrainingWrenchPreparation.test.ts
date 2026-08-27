import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareTorqueTrainingWrench } from '../../../api/client';

import { useTorqueTrainingWrenchPreparation } from './useTorqueTrainingWrenchPreparation';

vi.mock('../../../api/client', () => ({
  prepareTorqueTrainingWrench: vi.fn()
}));

const mockedPrepare = vi.mocked(prepareTorqueTrainingWrench);

const result = {
  requestId: 'request-1',
  confirmationId: 'confirmation-1',
  torqueWrenchProfileId: 'profile-1',
  serialNumber: 'TW-001',
  settingHistoryId: 'setting-1',
  settingVerificationMode: 'REGISTERED_SETTING',
  target: { lowerLimit: '9', nominalTorque: '10', upperLimit: '11', unit: 'N-m' },
  confirmedAt: '2026-08-09T00:00:00.000Z',
  duplicate: false
};

describe('useTorqueTrainingWrenchPreparation', () => {
  beforeEach(() => {
    mockedPrepare.mockReset();
    mockedPrepare.mockResolvedValue(result);
  });

  it('registers once and reuses the server result for connection retries', async () => {
    const { result: hook } = renderHook(() => useTorqueTrainingWrenchPreparation({
      sessionId: 'session-1',
      torqueWrenchProfileId: 'profile-1'
    }));

    let first;
    await act(async () => {
      first = await hook.current.prepare({ uid: 'NFC-1' });
    });
    let second;
    await act(async () => {
      second = await hook.current.prepare({ uid: 'NFC-1' });
    });

    expect(first).toEqual(result);
    expect(second).toEqual(result);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledWith('session-1', {
      uid: 'NFC-1',
      torqueWrenchProfileId: 'profile-1',
      requestId: expect.stringMatching(/^training-wrench-preparation-/),
      physicalSettingConfirmed: true
    });
    expect(hook.current.status).toBe('registered');
    expect(hook.current.requestId).toMatch(/^training-wrench-preparation-/);
  });

  it('coalesces double clicks while the first request is in flight', async () => {
    let resolveRequest: ((value: typeof result) => void) | undefined;
    mockedPrepare.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const { result: hook } = renderHook(() => useTorqueTrainingWrenchPreparation({
      sessionId: 'session-1',
      torqueWrenchProfileId: 'profile-1'
    }));

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = hook.current.prepare({ uid: 'NFC-1' });
      second = hook.current.prepare({ uid: 'NFC-1' });
    });
    expect(mockedPrepare).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.(result);
      await Promise.all([first, second]);
    });
    await waitFor(() => expect(hook.current.status).toBe('registered'));
  });

  it('resets the request when session or wrench changes', async () => {
    const { result: hook, rerender } = renderHook(
      ({ sessionId, profileId }) => useTorqueTrainingWrenchPreparation({ sessionId, torqueWrenchProfileId: profileId }),
      { initialProps: { sessionId: 'session-1', profileId: 'profile-1' } }
    );
    await act(async () => { await hook.current.prepare({ uid: 'NFC-1' }); });
    expect(hook.current.status).toBe('registered');

    rerender({ sessionId: 'session-2', profileId: 'profile-2' });
    await waitFor(() => expect(hook.current.status).toBe('idle'));
    expect(hook.current.result).toBeNull();
    expect(hook.current.requestId).toBeNull();
  });
});
