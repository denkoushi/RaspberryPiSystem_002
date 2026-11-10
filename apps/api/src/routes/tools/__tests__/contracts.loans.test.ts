import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { instrumentBorrowSchema, instrumentReturnSchema } from '../../measuring-instruments/schemas';
import { riggingBorrowSchema, riggingReturnSchema } from '../../rigging/schemas';
import { borrowSchema, returnSchema } from '../loans/schemas';
import type { BorrowPayload, ReturnPayload } from '@raspi-system/shared-types';

describe('契約テスト: loans schemas vs shared-types', () => {
  const borrowSample: BorrowPayload = {
    eventKey: '11111111-1111-4111-8111-111111111111',
    readAt: '2026-11-03T00:00:00.000Z',
    itemTagUid: 'ITEM-1234',
    employeeTagUid: 'EMP-5678',
    clientId: '11111111-1111-1111-1111-111111111111',
    note: null,
    dueAt: '2025-01-01T00:00:00.000Z'
  };

  const returnSample: ReturnPayload = {
    eventKey: '22222222-2222-4222-8222-222222222222',
    readAt: '2026-11-03T00:00:00.000Z',
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



describe('offline loan optional metadata contracts', () => {
  const cases = [
    [borrowSchema, { itemTagUid: 'TOOL', employeeTagUid: 'EMPLOYEE' }],
    [returnSchema, { loanId: '22222222-2222-2222-2222-222222222222' }],
    [instrumentBorrowSchema, { instrumentTagUid: 'MI', employeeTagUid: 'EMPLOYEE' }],
    [instrumentReturnSchema, { loanId: '22222222-2222-2222-2222-222222222222' }],
    [riggingBorrowSchema, { riggingTagUid: 'RG', employeeTagUid: 'EMPLOYEE' }],
    [riggingReturnSchema, { loanId: '22222222-2222-2222-2222-222222222222' }],
  ] as const;
  it.each(cases)('accepts old clients and validates eventKey/readAt', (schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
    const metadata = { eventKey: '11111111-1111-4111-8111-111111111111', readAt: '2026-11-03T09:00:00Z' };
    expect(schema.parse({ ...body, ...metadata })).toMatchObject({ ...metadata, readAt: new Date(metadata.readAt) });
    expect(schema.safeParse({ ...body, eventKey: 'invalid' }).success).toBe(false);
    expect(schema.safeParse({ ...body, readAt: 'invalid' }).success).toBe(false);
  });
});
