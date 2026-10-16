import { describe, expect, it } from 'vitest';

import { phoneNeighbor } from '../components/ShelfPhoneMap';

describe('phone north-up navigation', () => {
  it('maps directions independently of the legacy transposed desktop map', () => {
    expect(phoneNeighbor('c', 'n')).toBe('n');
    expect(phoneNeighbor('c', 's')).toBe('s');
    expect(phoneNeighbor('c', 'w')).toBe('w');
    expect(phoneNeighbor('c', 'e')).toBe('e');
    expect(phoneNeighbor('nw', 'n')).toBeNull();
    expect(phoneNeighbor('nw', 'w')).toBeNull();
  });
});
