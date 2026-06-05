import { describe, expect, it } from 'vitest';

import {
  buildThreeKeyLineageLockKey,
  isProductionThreeKeyLineage,
  PART_MEASUREMENT_TEMPLATE_LINEAGE_LOCK_NS
} from './part-measurement-template-lineage-lock.js';

describe('part-measurement-template-lineage-lock', () => {
  it('builds stable lineage lock keys', () => {
    const key = buildThreeKeyLineageLockKey('ABC', 'CUTTING', '033');
    expect(key).toBe('ABC|CUTTING|033');
    expect(buildThreeKeyLineageLockKey('abc', 'CUTTING', '033')).toBe(key);
    expect(buildThreeKeyLineageLockKey('ABC', 'CUTTING', '033')).toBe(key);
    expect(buildThreeKeyLineageLockKey('ABC', 'GRINDING', '033')).not.toBe(key);
  });

  it('uses dedicated advisory lock namespace', () => {
    expect(PART_MEASUREMENT_TEMPLATE_LINEAGE_LOCK_NS).toBeGreaterThan(0);
  });

  it('scopes production THREE_KEY lineage to CUTTING and GRINDING', () => {
    expect(isProductionThreeKeyLineage('THREE_KEY', 'CUTTING')).toBe(true);
    expect(isProductionThreeKeyLineage('THREE_KEY', 'GRINDING')).toBe(true);
    expect(isProductionThreeKeyLineage('THREE_KEY', 'CANDIDATE_FHINMEI_ONLY')).toBe(false);
    expect(isProductionThreeKeyLineage('FHINMEI_ONLY', 'CUTTING')).toBe(false);
  });
});
