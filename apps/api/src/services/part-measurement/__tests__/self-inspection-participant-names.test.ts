import { describe, expect, it } from 'vitest';

import { collectParticipantEmployeeNames } from '../self-inspection-participant-names.js';

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
