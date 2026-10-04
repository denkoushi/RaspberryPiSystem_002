import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestItem, createTestUser } from './helpers.js';

describe('loan and history response credential boundaries', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => { app = await buildServer(); });
  afterAll(async () => { await app.close(); });

  it('keeps cross-device loan display and borrow/return/cancel actions without exposing client/user credentials', async () => {
    const viewer = await createTestClientDevice('client-key-fixture-only-loan-viewer');
    const owner = await createTestClientDevice('client-key-fixture-only-loan-owner');
    const employee = await createTestEmployee();
    const item = await createTestItem();
    const operator = await createTestUser('ADMIN');
    const reader = await createTestUser('VIEWER');
    await prisma.user.update({ where: { id: operator.user.id }, data: { totpSecret: 'FIXTUREONLYTOTP', mfaBackupCodes: ['fixture-only-backup'] } });
    const payload = { employeeTagUid: employee.nfcTagUid, itemTagUid: item.nfcTagUid, note: 'Fixture display note' };
    const ownerHeaders = { 'x-client-key': owner.apiKey };
    const assertSafe = (body: string) => {
      for (const secret of [viewer.apiKey, owner.apiKey, operator.user.passwordHash, 'FIXTUREONLYTOTP', 'fixture-only-backup', employee.nfcTagUid!, item.nfcTagUid!]) expect(body).not.toContain(secret);
      for (const field of ['apiKey', 'passwordHash', 'totpSecret', 'mfaBackupCodes', 'nfcTagUid']) expect(body).not.toContain('"' + field + '"');
    };

    const borrowed = await app.inject({ method: 'POST', url: '/api/tools/loans/borrow', headers: ownerHeaders, payload });
    expect(borrowed.statusCode).toBe(200);
    assertSafe(borrowed.body);
    const loanId = borrowed.json().loan.id as string;
    const active = await app.inject({ method: 'GET', url: '/api/tools/loans/active', headers: { 'x-client-key': viewer.apiKey } });
    expect(active.statusCode).toBe(200);
    const shown = active.json().loans.find((loan: { id: string }) => loan.id === loanId);
    expect(shown).toMatchObject({ id: loanId, notes: 'Fixture display note', item: { name: item.name }, employee: { displayName: employee.displayName }, client: { id: owner.id, name: owner.name } });
    assertSafe(active.body);
    const activeViewer = await app.inject({ method: 'GET', url: '/api/tools/loans/active', headers: createAuthHeader(reader.token) });
    expect(activeViewer.statusCode).toBe(200);
    expect(activeViewer.json().loans.some((row: { id: string }) => row.id === loanId)).toBe(true);
    assertSafe(activeViewer.body);

    const returned = await app.inject({ method: 'POST', url: '/api/tools/loans/return', headers: createAuthHeader(operator.token), payload: { loanId, clientId: owner.id } });
    expect(returned.statusCode).toBe(200);
    expect(returned.json().loan.returnedAt).not.toBeNull();
    assertSafe(returned.body);
    const history = await app.inject({ method: 'GET', url: '/api/tools/transactions?clientId=' + owner.id, headers: createAuthHeader(operator.token) });
    expect(history.statusCode).toBe(200);
    expect(history.json().transactions.some((row: { performedByUser?: { username: string } }) => row.performedByUser?.username === operator.user.username)).toBe(true);
    expect(history.json().transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'BORROW', details: expect.objectContaining({
        itemSnapshot: { id: item.id, code: item.itemCode, name: item.name },
        employeeSnapshot: { id: employee.id, code: employee.employeeCode, name: employee.displayName },
      }) }),
    ]));
    assertSafe(history.body);
    const historyViewer = await app.inject({ method: 'GET', url: '/api/tools/transactions?clientId=' + owner.id, headers: createAuthHeader(reader.token) });
    expect(historyViewer.statusCode).toBe(200);
    assertSafe(historyViewer.body);

    const again = await app.inject({ method: 'POST', url: '/api/tools/loans/borrow', headers: ownerHeaders, payload });
    expect(again.statusCode).toBe(200);
    const cancelled = await app.inject({ method: 'POST', url: '/api/tools/loans/cancel', headers: ownerHeaders, payload: { loanId: again.json().loan.id } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().loan.cancelledAt).not.toBeNull();
    assertSafe(cancelled.body);
    const cancelledHistory = await app.inject({ method: 'GET', url: '/api/tools/transactions?clientId=' + owner.id, headers: createAuthHeader(reader.token) });
    expect(cancelledHistory.statusCode).toBe(200);
    expect(cancelledHistory.json().transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CANCEL', details: expect.objectContaining({ reason: '誤スキャンによる取消', itemSnapshot: { id: item.id, code: item.itemCode, name: item.name } }) }),
    ]));
    assertSafe(cancelledHistory.body);
  });
});
