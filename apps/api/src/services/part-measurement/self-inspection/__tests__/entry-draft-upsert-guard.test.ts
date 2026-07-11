import { describe, expect, it } from 'vitest';

import { resolveDraftUpsertExistingDecision } from '../entry-draft-upsert-guard.js';

describe('resolveDraftUpsertExistingDecision', () => {
  it('keeps CONFIRMED as noop', () => {
    expect(resolveDraftUpsertExistingDecision('CONFIRMED')).toBe('noop_keep_confirmed');
  });

  it('allows DRAFT updates', () => {
    expect(resolveDraftUpsertExistingDecision('DRAFT')).toBe('allow');
  });

  it('treats nullish as allow (create path uses separate branch)', () => {
    expect(resolveDraftUpsertExistingDecision(null)).toBe('allow');
    expect(resolveDraftUpsertExistingDecision(undefined)).toBe('allow');
  });
});
