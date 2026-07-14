import { describe, expect, it } from 'vitest';

import {
  collectParticipantEmployeeNames,
  collectParticipantEmployees
} from '../self-inspection-participant-names.js';

describe('collectParticipantEmployeeNames', () => {
  it('returns names in entryIndex order with duplicates removed', () => {
    expect(
      collectParticipantEmployeeNames([
        { entryIndex: 2, createdByEmployeeNameSnapshot: '佐藤' },
        { entryIndex: 0, createdByEmployeeNameSnapshot: '山田' },
        { entryIndex: 1, createdByEmployeeNameSnapshot: '山田' },
        { entryIndex: 3, createdByEmployeeNameSnapshot: '  ' },
        { entryIndex: 4, createdByEmployeeNameSnapshot: null }
      ])
    ).toEqual(['山田', '佐藤']);
  });

  it('returns empty array when entries are missing or empty', () => {
    expect(collectParticipantEmployeeNames(undefined)).toEqual([]);
    expect(collectParticipantEmployeeNames([])).toEqual([]);
  });
});

describe('collectParticipantEmployees', () => {
  it('returns identities in entryIndex order and deduplicates by employee ID', () => {
    expect(
      collectParticipantEmployees([
        { entryIndex: 3, createdByEmployeeId: 'e2', createdByEmployeeNameSnapshot: '山田' },
        { entryIndex: 0, createdByEmployeeId: 'e1', createdByEmployeeNameSnapshot: '山田' },
        { entryIndex: 1, createdByEmployeeId: 'e1', createdByEmployeeNameSnapshot: '旧姓' },
        { entryIndex: 2, createdByEmployeeId: null, createdByEmployeeNameSnapshot: '退職者' },
        { entryIndex: 4, createdByEmployeeId: 'e3', createdByEmployeeNameSnapshot: '  ' }
      ])
    ).toEqual([
      { employeeId: 'e1', displayName: '山田' },
      { employeeId: 'e2', displayName: '山田' }
    ]);
  });

  it('returns empty array when entries are missing or empty', () => {
    expect(collectParticipantEmployees(undefined)).toEqual([]);
    expect(collectParticipantEmployees([])).toEqual([]);
  });
});
