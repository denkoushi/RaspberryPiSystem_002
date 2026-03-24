import { describe, expect, it } from 'vitest';

import { presentActiveLoanListLines } from './activeLoanListLines';

describe('presentActiveLoanListLines', () => {
  it('returns rigging lines with idNum when value exists', () => {
    const lines = presentActiveLoanListLines({
      id: 'loan-1',
      borrowedAt: '2026-03-24T08:22:31.000Z',
      employee: { id: 'e1', employeeCode: '0001', displayName: '山田太郎', status: 'ACTIVE', createdAt: '', updatedAt: '' },
      item: null,
      riggingGear: { id: 'r1', managementNumber: 'K30B', name: 'ナイロンスリング', idNum: '101', status: 'AVAILABLE', createdAt: '', updatedAt: '' }
    });
    expect(lines.kind).toBe('rigging');
    expect(lines.primaryLine).toBe('K30B');
    expect(lines.nameLine).toBe('ナイロンスリング');
    expect(lines.idNumLine).toBe('旧番号: 101');
  });

  it('returns fallback idNum line for rigging when idNum is null', () => {
    const lines = presentActiveLoanListLines({
      id: 'loan-2',
      borrowedAt: '2026-03-24T08:22:31.000Z',
      employee: { id: 'e1', employeeCode: '0001', displayName: '山田太郎', status: 'ACTIVE', createdAt: '', updatedAt: '' },
      item: null,
      riggingGear: { id: 'r1', managementNumber: 'K30B', name: 'ナイロンスリング', idNum: null, status: 'AVAILABLE', createdAt: '', updatedAt: '' }
    });
    expect(lines.kind).toBe('rigging');
    expect(lines.idNumLine).toBe('旧番号: -');
  });

  it('returns instrument lines without idNum line', () => {
    const lines = presentActiveLoanListLines({
      id: 'loan-3',
      borrowedAt: '2026-03-24T08:22:31.000Z',
      employee: { id: 'e1', employeeCode: '0001', displayName: '山田太郎', status: 'ACTIVE', createdAt: '', updatedAt: '' },
      item: null,
      measuringInstrument: { id: 'm1', managementNumber: 'M-001', name: 'ノギス', status: 'AVAILABLE', createdAt: '', updatedAt: '' }
    });
    expect(lines.kind).toBe('instrument');
    expect(lines.primaryLine).toBe('M-001');
    expect(lines.nameLine).toBe('ノギス');
    expect(lines.idNumLine).toBeUndefined();
  });

  it('returns photo mode label for generic item when item is null', () => {
    const lines = presentActiveLoanListLines({
      id: 'loan-4',
      borrowedAt: '2026-03-24T08:22:31.000Z',
      photoUrl: '/api/storage/photos/sample.jpg',
      employee: { id: 'e1', employeeCode: '0001', displayName: '山田太郎', status: 'ACTIVE', createdAt: '', updatedAt: '' },
      item: null
    });
    expect(lines.kind).toBe('item');
    expect(lines.primaryLine).toBe('写真撮影モード');
  });
});
