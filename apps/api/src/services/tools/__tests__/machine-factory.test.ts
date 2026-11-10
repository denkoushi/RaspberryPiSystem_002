import { describe, expect, it } from 'vitest';
import { resolveMachineFactory } from '../machine-factory.js';

describe('resolveMachineFactory', () => {
  it.each([
    [' s001 ', 'SENDAI'], ['021', 'MISHIMA'], ['S-unknown', 'MISHIMA'],
    [null, 'MISHIMA'], [undefined, 'MISHIMA'], ['', 'MISHIMA'], ['  ', 'MISHIMA'],
  ])('classifies %j as %s', (resourceCd, factory) => {
    expect(resolveMachineFactory(resourceCd, new Set(['S001']))).toBe(factory);
  });
});
