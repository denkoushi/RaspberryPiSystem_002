import { describe, expect, it } from 'vitest';

import { composeArea, splitArea } from './areaNaming';

describe('areaNaming', () => {
  it('composes and splits machine + direction', () => {
    expect(composeArea(' 50013_540AP ', '北')).toBe('50013_540AP 北');
    expect(splitArea('50013_540AP 北')).toEqual({ machine: '50013_540AP', direction: '北' });
    expect(splitArea('30041R_2MF-P')).toEqual({ machine: '30041R_2MF-P', direction: null });
  });
});
