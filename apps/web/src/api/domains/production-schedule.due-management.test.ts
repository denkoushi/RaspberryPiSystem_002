import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ put: vi.fn(), post: vi.fn(), get: vi.fn() }));
vi.mock('../http', () => ({ api: mocks }));

import {
  DUE_MANAGEMENT_AUTH_SESSION_KEY, DUE_MANAGEMENT_TOKEN_SESSION_KEY,
  autoGenerateKioskProductionScheduleDueManagementGlobalRank,
  updateKioskProductionScheduleDueManagementDailyPlan,
  updateKioskProductionScheduleDueManagementGlobalRank,
  updateKioskProductionScheduleDueManagementPartNote,
  updateKioskProductionScheduleDueManagementPartPriorities,
  updateKioskProductionScheduleDueManagementPartProcessingType,
  updateKioskProductionScheduleDueManagementSeibanDueDate,
  updateKioskProductionScheduleDueManagementSeibanProcessingDueDate,
  updateKioskProductionScheduleDueManagementTriageSelection,
  verifyKioskDueManagementAccessPassword
} from './production-schedule';

const mutations = {
  processing: () => updateKioskProductionScheduleDueManagementPartProcessingType('A', 'X', { processingType: '塗装' }),
  note: () => updateKioskProductionScheduleDueManagementPartNote('A', 'X', { note: 'memo' }),
  priorities: () => updateKioskProductionScheduleDueManagementPartPriorities('A', { orderedFhincds: ['X'] }),
  selection: () => updateKioskProductionScheduleDueManagementTriageSelection({ selectedFseibans: ['A'] }),
  dailyPlan: () => updateKioskProductionScheduleDueManagementDailyPlan({ orderedFseibans: ['A'] }),
  globalRank: () => updateKioskProductionScheduleDueManagementGlobalRank({ orderedFseibans: ['A'] }),
  autoGenerate: () => autoGenerateKioskProductionScheduleDueManagementGlobalRank({ targetLocation: 'other-location' })
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(DUE_MANAGEMENT_AUTH_SESSION_KEY, '1');
  window.sessionStorage.setItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY, 'session-token');
  for (const request of Object.values(mocks)) request.mockResolvedValue({ data: { success: true } });
});

describe('due-management client authorization', () => {
  it.each(Object.entries(mutations))('attaches the session token to %s without changing its body', async (_name, mutate) => {
    await mutate();
    const calls = [mocks.put, mocks.post].flatMap((request) => request.mock.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toEqual({ headers: { 'x-due-management-token': 'session-token' } });
    expect(calls[0][1]).not.toHaveProperty('token');
  });

  it.each(['DUE_MANAGEMENT_TOKEN_REQUIRED', 'DUE_MANAGEMENT_TOKEN_INVALID', 'DUE_MANAGEMENT_TOKEN_EXPIRED', 'DUE_MANAGEMENT_TOKEN_DEVICE_MISMATCH'])('clears authentication on %s', async (code) => {
    const error = { isAxiosError: true, response: { status: 403, data: { code } } };
    mocks.put.mockRejectedValueOnce(error);
    await expect(mutations.note()).rejects.toBe(error);
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY)).toBeNull();
  });

  it.each([
    { isAxiosError: true, response: { status: 403, data: { code: 'AUTH_INSUFFICIENT_PERMISSIONS' } } },
    { isAxiosError: true, response: { status: 500, data: { code: 'DUE_MANAGEMENT_TOKEN_INVALID' } } },
    { isAxiosError: true, code: 'ECONNABORTED' }
  ])('keeps authentication for unrelated failures', async (error) => {
    mocks.put.mockRejectedValueOnce(error);
    await expect(mutations.dailyPlan()).rejects.toBe(error);
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_AUTH_SESSION_KEY)).toBe('1');
    expect(window.sessionStorage.getItem(DUE_MANAGEMENT_TOKEN_SESSION_KEY)).toBe('session-token');
  });

  it('keeps both leader due-date updates independent of the token', async () => {
    window.sessionStorage.clear();
    await updateKioskProductionScheduleDueManagementSeibanDueDate('A', { dueDate: '2026-10-07' });
    await updateKioskProductionScheduleDueManagementSeibanProcessingDueDate('A', 'LSLH', { dueDate: '2026-10-07' });
    expect(mocks.put.mock.calls).toHaveLength(2);
    for (const call of mocks.put.mock.calls) expect(call).toHaveLength(2);
  });

  it('returns the password confirmation token without requiring a previous token', async () => {
    window.sessionStorage.clear();
    mocks.post.mockResolvedValueOnce({ data: { success: true, token: 'new-token' } });
    expect(await verifyKioskDueManagementAccessPassword({ password: 'test-password' })).toEqual({ success: true, token: 'new-token' });
    expect(mocks.post).toHaveBeenCalledWith('/kiosk/production-schedule/due-management/verify-access-password', { password: 'test-password' });
  });
});
