import { describe, expect, it } from 'vitest';

import { authorizeReceiver } from '../kiosk-inquiry.service.js';

describe('kiosk inquiry login authorization', () => {
  const receiver = { id: 'receiver', inquiryReceiverEnabled: true, systemNoticeReceiverEnabled: false };

  it.each(['ADMIN', 'MANAGER'] as const)('grants screen viewing to a logged-in %s', async role => {
    await expect(authorizeReceiver(receiver, undefined, { id: 'login-user', role })).resolves.toEqual({
      employeeId: null, userId: 'login-user', canViewScreen: true
    });
  });

  it('does not unlock a receiver for a VIEWER login', async () => {
    await expect(authorizeReceiver(receiver, undefined, { id: 'login-user', role: 'VIEWER' })).rejects.toMatchObject({
      code: 'KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED'
    });
  });
});
