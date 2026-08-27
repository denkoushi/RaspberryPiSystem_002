import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyDueManagementAccessPassword = vi.hoisted(() => vi.fn());

vi.mock('../production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword
}));

import { TorqueTrainingKioskSettingsService } from './torque-training-kiosk-settings.service.js';

describe('TorqueTrainingKioskSettingsService access boundary', () => {
  const service = new TorqueTrainingKioskSettingsService();

  beforeEach(() => {
    verifyDueManagementAccessPassword.mockReset();
  });

  it('uses the shared operation-password verifier for every kiosk request', async () => {
    verifyDueManagementAccessPassword.mockResolvedValue({ success: true });

    await service.requireAccessPassword('2520');

    expect(verifyDueManagementAccessPassword).toHaveBeenCalledWith({
      location: 'shared',
      password: '2520'
    });
  });

  it('rejects a missing or incorrect password with a stable API error', async () => {
    verifyDueManagementAccessPassword.mockResolvedValue({ success: false });

    await expect(service.requireAccessPassword(undefined)).rejects.toMatchObject({
      statusCode: 403,
      code: 'TORQUE_TRAINING_SETTINGS_ACCESS_DENIED'
    });
    expect(verifyDueManagementAccessPassword).toHaveBeenCalledWith({
      location: 'shared',
      password: ''
    });
  });
});
