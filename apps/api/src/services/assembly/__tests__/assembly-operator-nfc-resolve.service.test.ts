import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    employee: { findFirst: vi.fn() }
  }
}));

import { prisma } from '../../../lib/prisma.js';
import { resolveAssemblyOperatorNfcUid } from '../assembly-operator-nfc-resolve.service.js';

describe('resolveAssemblyOperatorNfcUid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for blank uid', async () => {
    await expect(resolveAssemblyOperatorNfcUid('   ')).resolves.toBeNull();
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('returns employee when tag matches', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: 'emp-1',
      displayName: '山田太郎',
      nfcTagUid: 'UID-1'
    } as never);

    await expect(resolveAssemblyOperatorNfcUid('UID-1')).resolves.toEqual({
      employeeId: 'emp-1',
      displayName: '山田太郎'
    });
  });

  it('returns null when employee is not found', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);

    await expect(resolveAssemblyOperatorNfcUid('UNKNOWN')).resolves.toBeNull();
  });
});
