import { describe, expect, it } from 'vitest';
import type { Transaction } from '@prisma/client';

import { toLoanResponse, toTransactionResponse, type LoanResponseSource } from './loan-response.js';

const date = new Date('2026-01-01T00:00:00Z');
const client = { id: 'fixture-client', name: 'Test terminal', location: 'Test room', apiKey: 'fixture-only-client-secret', signagePreviewTargetApiKey: 'fixture-only-preview-secret', futureSecret: 'fixture-only-future-client' };
const user = { id: 'fixture-user', username: 'Test operator', passwordHash: 'fixture-only-password-hash', totpSecret: 'fixture-only-totp', mfaBackupCodes: ['fixture-only-backup-code'] };
const loan: LoanResponseSource = {
  id: 'fixture-loan', itemId: 'fixture-item', measuringInstrumentId: null, riggingGearId: null,
  employeeId: 'fixture-employee', clientId: client.id, borrowedAt: date, dueAt: null, returnedAt: null, cancelledAt: null,
  notes: 'Display note', photoUrl: '/api/storage/photos/fixture.jpg', photoTakenAt: date,
  photoBorrowIdempotencyKey: 'fixture-only-idempotency', photoBorrowRequestFingerprint: 'fixture-only-fingerprint',
  photoToolDisplayName: 'Display tool', photoToolVlmLabelProvenance: 'UNKNOWN', photoToolLabelRequested: false, photoToolLabelClaimedAt: null,
  photoToolHumanDisplayName: 'Reviewed tool', photoToolHumanQuality: null, photoToolHumanReviewedAt: null,
  photoToolHumanReviewedByUserId: user.id, photoToolGallerySeed: false, createdAt: date, updatedAt: date,
  item: { id: 'fixture-item', itemCode: 'TO0001', name: 'Test tool', nfcTagUid: 'fixture-only-item-tag' },
  employee: { id: 'fixture-employee', employeeCode: '0001', displayName: 'Test employee', department: 'Test department', nfcTagUid: 'fixture-only-employee-tag' },
  client, performedByUser: user, photoToolHumanReviewedBy: user,
};

function expectNoCredentials(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [client.apiKey, client.signagePreviewTargetApiKey, client.futureSecret, user.passwordHash, user.totpSecret, user.mfaBackupCodes[0], loan.photoBorrowIdempotencyKey!, loan.photoBorrowRequestFingerprint!, loan.item!.nfcTagUid!, loan.employee!.nfcTagUid!]) {
    expect(text).not.toContain(secret);
  }
  for (const field of ['apiKey', 'passwordHash', 'totpSecret', 'mfaBackupCodes', 'signagePreviewTargetApiKey', 'futureSecret', 'nfcTagUid']) expect(text).not.toContain('"' + field + '"');
}

describe('loan HTTP response allowlist', () => {
  it('preserves display/action fields while removing credentials and internal fields recursively', () => {
    const response = toLoanResponse(loan);
    expect(response).toMatchObject({ id: loan.id, clientId: client.id, borrowedAt: date, notes: 'Display note', photoUrl: loan.photoUrl, photoToolHumanDisplayName: 'Reviewed tool', item: { itemCode: 'TO0001', name: 'Test tool' }, employee: { displayName: 'Test employee', department: 'Test department' }, client: { id: client.id, name: client.name, location: client.location }, performedByUser: { id: user.id, username: user.username } });
    expectNoCredentials(response);
    expect(loan.client!.apiKey).toBe(client.apiKey);
  });

  it('keeps instrument/rigging display fields and nullable relations', () => {
    const response = toLoanResponse({ ...loan, item: null, employee: null, client: null, performedByUser: null,
      measuringInstrument: { id: 'fixture-instrument', managementNumber: 'M0001', name: 'Test gauge' },
      riggingGear: { id: 'fixture-rigging', managementNumber: 'R0001', name: 'Test sling', idNum: '001' },
    });
    expect(response.item).toBeNull();
    expect(response.client).toBeNull();
    expect(response.employee).toBeNull();
    expect(response.measuringInstrument?.managementNumber).toBe('M0001');
    expect(response.riggingGear?.idNum).toBe('001');
    expectNoCredentials(response);
  });

  it('applies the same boundary to nested loans and client/user relations in history', () => {
    const transaction: Transaction & { loan: typeof loan; client: typeof client; performedByUser: typeof user } = {
      id: 'fixture-transaction', loanId: loan.id, action: 'RETURN', actorEmployeeId: loan.employeeId,
      performedByUserId: user.id, clientId: client.id, details: {
        reason: 'TEST', note: 'History display note',
        itemSnapshot: { id: loan.itemId, code: loan.item!.itemCode, name: loan.item!.name, nfcTagUid: loan.item!.nfcTagUid },
        employeeSnapshot: { id: loan.employeeId, code: loan.employee!.employeeCode, name: loan.employee!.displayName, nfcTagUid: loan.employee!.nfcTagUid, futureSecret: client.futureSecret },
        futureSecret: client.futureSecret,
      }, createdAt: date,
      loan, client, performedByUser: user,
    };
    const response = toTransactionResponse(transaction);
    expect(response).toMatchObject({ action: 'RETURN', details: { reason: 'TEST', note: 'History display note', itemSnapshot: { id: loan.itemId, code: 'TO0001', name: 'Test tool' }, employeeSnapshot: { id: loan.employeeId, code: '0001', name: 'Test employee' } }, performedByUser: { id: user.id, username: user.username }, loan: { id: loan.id, employee: { displayName: 'Test employee' } }, client: { name: client.name } });
    expectNoCredentials(response);
    expect(transaction.details).toHaveProperty('itemSnapshot.nfcTagUid', loan.item!.nfcTagUid);
    expect(toTransactionResponse({ ...transaction, loan: null }).loan).toBeNull();
  });

  it('keeps asset/photo/reassignment detail fields and rejects unknown or nested credential fields', () => {
    const transaction: Transaction = {
      id: 'fixture-asset-transaction', loanId: loan.id, action: 'RETURN', actorEmployeeId: loan.employeeId,
      performedByUserId: null, clientId: client.id, createdAt: date,
      details: {
        note: null, reason: 'MANUAL_CLIENT_ASSIGNMENT', previousClientId: null, newClientId: client.id,
        photoUrl: loan.photoUrl, photoTakenAt: date.toISOString(), source: 'self_inspection_pre_use_inspection',
        itemSnapshot: null,
        instrumentSnapshot: { id: 'fixture-instrument', managementNumber: 'M0001', name: 'Test gauge', futureSecret: client.futureSecret },
        riggingSnapshot: { id: 'fixture-rigging', managementNumber: 'R0001', name: 'Test sling', apiKey: client.apiKey },
        futureSecret: client.futureSecret,
      },
    };
    expect(toTransactionResponse(transaction).details).toEqual({
      note: null, reason: 'MANUAL_CLIENT_ASSIGNMENT', previousClientId: null, newClientId: client.id,
      photoUrl: loan.photoUrl, photoTakenAt: date.toISOString(), source: 'self_inspection_pre_use_inspection',
      itemSnapshot: null,
      instrumentSnapshot: { id: 'fixture-instrument', managementNumber: 'M0001', name: 'Test gauge' },
      riggingSnapshot: { id: 'fixture-rigging', managementNumber: 'R0001', name: 'Test sling' },
    });
    expectNoCredentials(toTransactionResponse(transaction));
    expect(toTransactionResponse({ ...transaction, details: null }).details).toBeNull();
    expect(toTransactionResponse({ ...transaction, details: { note: { apiKey: client.apiKey } } }).details).toEqual({});
  });
});
