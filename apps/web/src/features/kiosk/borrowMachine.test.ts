import { describe, expect, it } from 'vitest';
import { interpret } from 'xstate';
import { createBorrowMachine } from './borrowMachine';
import type { Loan } from '../../api/types';

describe('borrow state machine', () => {
  it('moves through scanning -> confirm -> success', async () => {
    const loan: Loan = {
      id: 'loan-1',
      borrowedAt: new Date().toISOString(),
      dueAt: null,
      returnedAt: null,
      notes: null,
      employee: {
        id: 'emp',
        employeeCode: 'EMP-001',
        displayName: 'テスト',
        nfcTagUid: '01',
        department: null,
        contact: null,
        status: 'ACTIVE',
        createdAt: '',
        updatedAt: ''
      },
      item: {
        id: 'itm',
        itemCode: 'ITEM-001',
        name: 'ドリル',
        description: null,
        nfcTagUid: '02',
        category: null,
        storageLocation: null,
        status: 'AVAILABLE',
        notes: null,
        createdAt: '',
        updatedAt: ''
      },
      client: null
    };
    const machine = createBorrowMachine();
    const service = interpret(machine).start();
    service.send({ type: 'ITEM_SCANNED', uid: 'item-uid' });
    expect(service.getSnapshot().value).toBe('waitEmployee');
    service.send({ type: 'EMPLOYEE_SCANNED', uid: 'emp-uid' });
    expect(service.getSnapshot().value).toBe('submitting');
    service.send({ type: 'SUCCESS', loan });
    expect(service.getSnapshot().value).toBe('success');
    service.stop();
  });
});
