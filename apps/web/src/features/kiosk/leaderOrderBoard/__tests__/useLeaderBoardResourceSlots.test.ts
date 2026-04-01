import { describe, expect, it } from 'vitest';

import { uniqueOrderedResourceCds } from '../useLeaderBoardResourceSlots';

describe('uniqueOrderedResourceCds', () => {
  it('keeps slot order and skips nulls', () => {
    expect(uniqueOrderedResourceCds(['305', null, '401'])).toEqual(['305', '401']);
  });

  it('dedupes later duplicates', () => {
    expect(uniqueOrderedResourceCds(['305', '401', '305'])).toEqual(['305', '401']);
  });

  it('trims and drops empty', () => {
    expect(uniqueOrderedResourceCds(['  ', '  99  ', null])).toEqual(['99']);
  });
});
