import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    measuringInstrumentTag: { findUnique: vi.fn() }
  }
}));

import { prisma } from '../../../lib/prisma.js';
import { resolveSelfInspectionNfcTagUid } from '../self-inspection-nfc-tag-resolve.js';

describe('resolveSelfInspectionNfcTagUid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unknown for blank uid', async () => {
    await expect(resolveSelfInspectionNfcTagUid('   ')).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns employee when only employee matches', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: 'emp-1',
      displayName: 'Alice',
      nfcTagUid: 'UID-1'
    } as never);
    vi.mocked(prisma.measuringInstrumentTag.findUnique).mockResolvedValue(null as never);

    await expect(resolveSelfInspectionNfcTagUid('UID-1')).resolves.toEqual({
      kind: 'employee',
      employee: { id: 'emp-1', displayName: 'Alice', nfcTagUid: 'UID-1' }
    });
  });

  it('returns duplicate when both match', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: 'emp-1',
      displayName: 'Alice',
      nfcTagUid: 'UID-1'
    } as never);
    vi.mocked(prisma.measuringInstrumentTag.findUnique).mockResolvedValue({
      rfidTagUid: 'UID-1',
      measuringInstrument: {
        id: 'inst-1',
        name: 'Caliper',
        managementNumber: 'MI-001',
        status: 'AVAILABLE'
      }
    } as never);

    await expect(resolveSelfInspectionNfcTagUid('UID-1')).resolves.toEqual({ kind: 'duplicate' });
  });

  it('returns instrument_unavailable when instrument is retired', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.measuringInstrumentTag.findUnique).mockResolvedValue({
      rfidTagUid: 'UID-RETIRED',
      measuringInstrument: {
        id: 'inst-retired',
        name: 'Old Caliper',
        managementNumber: 'MI-OLD',
        status: 'RETIRED'
      }
    } as never);

    await expect(resolveSelfInspectionNfcTagUid('UID-RETIRED')).resolves.toEqual({
      kind: 'instrument_unavailable',
      reason: 'retired'
    });
  });
});
