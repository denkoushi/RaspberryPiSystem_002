import { describe, expect, it } from 'vitest';

import { emptyRecord, shortUid, toPayload, uidBytes } from './tagDeskModel';

describe('tagDeskModel', () => {
  it('splits hex UIDs into bytes and leaves other IDs whole', () => {
    expect(uidBytes('04a1b2c3d45e80')).toEqual(['04', 'A1', 'B2', 'C3', 'D4', '5E', '80']);
    expect(uidBytes('04:A1:B2:C3')).toEqual(['04', 'A1', 'B2', 'C3']);
    expect(uidBytes('TAG_EMP_1')).toEqual(['TAG_EMP_1']);
    expect(shortUid('04A1B2C3D45E80')).toBe('A1:B2:C3:D4');
  });

  it('turns blank optional fields into null and converts numbers', () => {
    const values = { ...emptyRecord('rigging'), name: '吊具A', managementNumber: 'R-1', maxLoadTon: '2.5', storageLocation: '' };
    expect(toPayload('rigging', values)).toMatchObject({
      name: '吊具A',
      managementNumber: 'R-1',
      maxLoadTon: 2.5,
      lengthMm: null,
      storageLocation: null,
      startedAt: null,
      status: 'AVAILABLE'
    });
  });
});
