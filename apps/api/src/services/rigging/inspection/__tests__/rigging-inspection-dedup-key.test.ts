import { describe, expect, it } from 'vitest';

import { buildRiggingInspectionDedupKey } from '../rigging-inspection-dedup-key.js';

describe('buildRiggingInspectionDedupKey', () => {
  it('combines managementNumber, JST business date, and normalized inspector name', () => {
    const key = buildRiggingInspectionDedupKey({
      managementNumber: 'RG-001',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
      inspectorName: '山田  太郎',
    });
    expect(key).toBe('RG-001|2026-04-30|山田太郎');
  });

  it('uses the same business date for timestamps on the same JST business day', () => {
    const morning = buildRiggingInspectionDedupKey({
      managementNumber: 'RG-002',
      inspectedAt: new Date('2026-04-30T00:00:00.000Z'),
      inspectorName: '佐藤',
    });
    const later = buildRiggingInspectionDedupKey({
      managementNumber: 'RG-002',
      inspectedAt: new Date('2026-04-30T03:00:00.000Z'),
      inspectorName: '佐藤',
    });
    expect(morning).toBe(later);
  });
});
