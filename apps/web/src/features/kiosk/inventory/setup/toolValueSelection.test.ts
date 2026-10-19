import { describe, expect, it } from 'vitest';

import { joinToolValues, splitToolValues, toggleToolValue, toolValueOptions } from './toolValueSelection';

describe('tool value selection', () => {
  it('splits, trims and de-duplicates individual values and joins them with ・', () => {
    expect(splitToolValues(' 鋼・SUS・・鋼 ')).toEqual(['鋼', 'SUS']);
    expect(splitToolValues('')).toEqual([]);
    expect(joinToolValues(['鋼', 'SUS', '鋼', ''])).toBe('鋼・SUS');
    expect(toolValueOptions('workMaterial', ['鋼・SUS', '鋼', 'アルミ'])).toEqual(['鋼', 'SUS', 'アルミ']);
    expect(toolValueOptions('name', ['治具・A', '治具・A'])).toEqual(['治具・A']);
  });
  it('adds and removes values in every lane except the single name', () => {
    for (const field of ['maker', 'toolName', 'model', 'toolSize', 'workMaterial', 'usage'] as const) {
      expect(toggleToolValue(field, '鋼', 'SUS')).toBe('鋼・SUS');
      expect(toggleToolValue(field, '鋼・SUS', '鋼')).toBe('SUS');
      expect(toggleToolValue(field, 'SUS', 'SUS')).toBe('');
    }
    expect(toggleToolValue('name', '治具A', '治具B')).toBe('治具B');
    expect(toggleToolValue('name', '治具A', '治具A')).toBe('');
  });
});
