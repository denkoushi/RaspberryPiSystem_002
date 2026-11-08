import { describe, expect, it } from 'vitest';
import { assertSubjectPatternUnchanged } from './subject-pattern-policy.js';

describe('Gmail subject pattern authorization', () => {
  it('allows ADMIN to create or change the pattern', () => {
    expect(() => assertSubjectPatternUnchanged('ADMIN', 'new', 'old')).not.toThrow();
  });
  it.each([undefined, null, ''])('allows MANAGER creation with empty value %s', (value) => {
    expect(() => assertSubjectPatternUnchanged('MANAGER', value)).not.toThrow();
  });
  it('allows unchanged or omitted fields on MANAGER updates', () => {
    expect(() => assertSubjectPatternUnchanged('MANAGER', 'saved', 'saved')).not.toThrow();
    expect(() => assertSubjectPatternUnchanged('MANAGER', undefined, 'saved')).not.toThrow();
  });
  it.each([['new', null], ['changed', 'saved'], [null, 'saved']])('rejects MANAGER change %s from %s', (next, stored) => {
    expect(() => assertSubjectPatternUnchanged('MANAGER', next, stored)).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});
