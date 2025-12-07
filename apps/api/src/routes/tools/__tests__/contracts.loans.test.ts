import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { borrowSchema, returnSchema } from '../loans/schemas';
import type { BorrowPayload, ReturnPayload } from '@raspi-system/shared-types';

describe('契約テスト: loans schemas vs shared-types', () => {
  const borrowSample: BorrowPayload = {
    itemTagUid: 'ITEM-1234',
    employeeTagUid: 'EMP-5678',
    clientId: '11111111-1111-1111-1111-111111111111',
    note: null,
    dueAt: '2025-01-01T00:00:00.000Z'
  };

  const returnSample: ReturnPayload = {
    loanId: '22222222-2222-2222-2222-222222222222',
    clientId: '11111111-1111-1111-1111-111111111111',
    note: null,
    performedByUserId: '33333333-3333-3333-3333-333333333333'
  };

  it('borrow payload is accepted by schema', () => {
    expect(() => borrowSchema.parse(borrowSample)).not.toThrow();
  });

  it('return payload is accepted by schema', () => {
    expect(() => returnSchema.parse(returnSample)).not.toThrow();
  });

  it('schema inferred type aligns with shared BorrowPayload keys', () => {
    const keysSchema = Object.keys(borrowSchema.shape).sort();
    const keysSample = Object.keys(borrowSample).sort();
    expect(keysSample).toEqual(keysSchema);
  });

  it('schema inferred type aligns with shared ReturnPayload keys', () => {
    const keysSchema = Object.keys(returnSchema.shape).sort();
    const keysSample = Object.keys(returnSample).sort();
    expect(keysSample).toEqual(keysSchema);
  });
});

