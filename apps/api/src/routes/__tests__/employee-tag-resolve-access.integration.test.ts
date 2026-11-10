import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

describe('employee tag resolve access', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let employee: Awaited<ReturnType<typeof createTestEmployee>>;
  let client: Awaited<ReturnType<typeof createTestClientDevice>>;
  const users: Awaited<ReturnType<typeof createTestUser>>[] = [];

  beforeAll(async () => {
    app = await buildServer();
    employee = await createTestEmployee();
    client = await createTestClientDevice();
    for (const role of ['VIEWER', 'ADMIN', 'MANAGER'] as const) {
      users.push(await createTestUser(role));
    }
  });

  afterAll(async () => {
    if (employee) await prisma.employee.delete({ where: { id: employee.id } });
    if (client) await prisma.clientDevice.delete({ where: { id: client.id } });
    for (const { user } of users) await prisma.user.delete({ where: { id: user.id } });
    await app?.close();
  });

  describe.each([
    '/api/part-measurement/self-inspection/nfc-tags/resolve',
    '/api/part-measurement/self-inspection/record-approvals/approver/resolve',
    '/api/assembly/operators/resolve-nfc'
  ])('%s', (url) => {
    it('returns 403 for a VIEWER JWT', async () => {
      const response = await app.inject({
        method: 'POST', url, headers: createAuthHeader(users[0]!.token), payload: { uid: employee.nfcTagUid }
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 for a VIEWER JWT even with a terminal key', async () => {
      const response = await app.inject({
        method: 'POST', url,
        headers: { ...createAuthHeader(users[0]!.token), 'x-client-key': client.apiKey },
        payload: { uid: employee.nfcTagUid }
      });
      expect(response.statusCode).toBe(403);
    });

    it.each(['terminal key', 'ADMIN', 'MANAGER'])('resolves the employee with %s', async (access) => {
      const headers = access === 'terminal key'
        ? { 'x-client-key': client.apiKey }
        : createAuthHeader(users[access === 'ADMIN' ? 1 : 2]!.token);
      const response = await app.inject({ method: 'POST', url, headers, payload: { uid: employee.nfcTagUid } });
      expect(response.statusCode).toBe(200);
      if (url.endsWith('/resolve-nfc')) {
        expect(response.json()).toEqual({
          employeeId: employee.id, employeeCode: employee.employeeCode,
          displayName: employee.displayName, nfcTagUid: employee.nfcTagUid
        });
      } else {
        expect(response.json().result).toEqual({
          kind: 'employee',
          employee: {
            id: employee.id,
            ...(url.includes('/approver/') ? { employeeCode: employee.employeeCode } : {}),
            displayName: employee.displayName, nfcTagUid: employee.nfcTagUid
          }
        });
      }
    });
  });
});
