import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyDueManagementAccessPassword = vi.hoisted(() => vi.fn());

vi.mock('../../production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword
}));

import { SelfInspectionRegistrationPolicyAccessService } from '../self-inspection-registration-policy-access.service.js';

describe('SelfInspectionRegistrationPolicyAccessService', () => {
  const service = new SelfInspectionRegistrationPolicyAccessService();

  beforeEach(() => {
    verifyDueManagementAccessPassword.mockReset();
  });

  it('reuses the shared password verifier for valid kiosk mutations', async () => {
    verifyDueManagementAccessPassword.mockResolvedValue({ success: true });

    await service.requireAccessPassword('2520');

    expect(verifyDueManagementAccessPassword).toHaveBeenCalledWith({
      location: 'shared',
      password: '2520'
    });
  });

  it('rejects missing or incorrect kiosk passwords with 403', async () => {
    verifyDueManagementAccessPassword.mockResolvedValue({ success: false });

    await expect(service.requireAccessPassword(undefined)).rejects.toMatchObject({ statusCode: 403 });
    expect(verifyDueManagementAccessPassword).toHaveBeenCalledWith({
      location: 'shared',
      password: ''
    });
  });
});
