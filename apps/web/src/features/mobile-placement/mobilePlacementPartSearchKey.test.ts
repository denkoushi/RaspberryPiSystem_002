import { describe, expect, it } from 'vitest';

import { mobilePlacementQueryKeys } from './mobilePlacementQueryKeys';

describe('mobilePlacementQueryKeys.partSearch', () => {

  it('preserves partSearch values, order and boundary arguments', () => {
    expect(mobilePlacementQueryKeys.partSearch('part-1', 'machine-1')).toEqual(['mobile-placement-part-search', 'part-1', 'machine-1']);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, [undefined, undefined])).toEqual(['mobile-placement-part-search', undefined, undefined]);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, [null, null])).toEqual(['mobile-placement-part-search', null, null]);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, [{}, {}])).toEqual(['mobile-placement-part-search', {}, {}]);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, ['', ''])).toEqual(['mobile-placement-part-search', '', '']);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, [])).toEqual(['mobile-placement-part-search', undefined, undefined]);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, ['part-1'])).toEqual(['mobile-placement-part-search', 'part-1', undefined]);
    expect(Reflect.apply(mobilePlacementQueryKeys.partSearch, undefined, [undefined, 'machine-1'])).toEqual(['mobile-placement-part-search', undefined, 'machine-1']);
  });
});
