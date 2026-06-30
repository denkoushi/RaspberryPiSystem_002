import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../self-inspection-nfc-tag-resolve.js', () => ({
  resolveSelfInspectionNfcTagUid: vi.fn()
}));

import { ApiError } from '../../../lib/errors.js';
import { resolveSelfInspectionNfcTagUid } from '../self-inspection-nfc-tag-resolve.js';
import { assertSelfInspectionEntryRegistrationTagUids } from '../self-inspection-registration-tag-validation.js';

describe('assertSelfInspectionEntryRegistrationTagUids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects duplicate uid in both payload fields when tag is duplicate in master data', async () => {
    vi.mocked(resolveSelfInspectionNfcTagUid).mockResolvedValue({ kind: 'duplicate' });

    await expect(
      assertSelfInspectionEntryRegistrationTagUids({
        employeeTagUid: 'UID-1',
        measuringInstrumentTagUid: 'UID-1'
      })
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: '同一タグが社員と計測機器の両方に登録されています。管理データを修正してください。'
      })
    );
  });

  it('rejects duplicate uid in both payload fields when tag resolves to a single kind', async () => {
    vi.mocked(resolveSelfInspectionNfcTagUid).mockResolvedValue({
      kind: 'employee',
      employee: { id: 'emp-1', displayName: 'Alice', nfcTagUid: 'UID-1' }
    });

    await expect(
      assertSelfInspectionEntryRegistrationTagUids({
        employeeTagUid: 'UID-1',
        measuringInstrumentTagUid: 'UID-1'
      })
    ).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: '測定者と計測機器に同じNFCタグは使用できません'
      })
    );
  });

  it('rejects employee tag uid that is duplicate in master data', async () => {
    vi.mocked(resolveSelfInspectionNfcTagUid).mockResolvedValue({ kind: 'duplicate' });

    await expect(
      assertSelfInspectionEntryRegistrationTagUids({
        employeeTagUid: 'UID-DUP'
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('allows valid distinct employee and instrument tags', async () => {
    vi.mocked(resolveSelfInspectionNfcTagUid)
      .mockResolvedValueOnce({
        kind: 'employee',
        employee: { id: 'emp-1', displayName: 'Alice', nfcTagUid: 'UID-E' }
      })
      .mockResolvedValueOnce({
        kind: 'instrument',
        instrument: {
          id: 'inst-1',
          name: 'Caliper',
          managementNumber: 'MI-001',
          tagUid: 'UID-I'
        }
      });

    await expect(
      assertSelfInspectionEntryRegistrationTagUids({
        employeeTagUid: 'UID-E',
        measuringInstrumentTagUid: 'UID-I'
      })
    ).resolves.toBeUndefined();
  });
});
