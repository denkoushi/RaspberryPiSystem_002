import { describe, expect, it } from 'vitest';

import { mapOutsourcingPlanToSimulateResult } from '../mapOutsourcingPlanToSimulateResult';

describe('mapOutsourcingPlanToSimulateResult', () => {
  it('plan の before/after を simulate 形に写す', () => {
    const mapped = mapOutsourcingPlanToSimulateResult({
      siteKey: '第2工場',
      yearMonth: '2026-05',
      mode: 'outsourcing',
      strategy: 'max_over_reduction',
      selectedCandidateIds: ['S\u001fP\u001fH'],
      beforeResources: [{ resourceCd: 'A01', requiredMinutes: 100, availableMinutes: 50, overMinutes: 50, classCode: null }],
      afterResources: [
        {
          resourceCd: 'A01',
          requiredMinutes: 0,
          availableMinutes: 50,
          overMinutes: 0,
          classCode: null,
          reducedMinutes: 100
        }
      ],
      resolved: true,
      remainingOverMinutes: 0,
      totalReducedMinutes: 100,
      totalOverReductionMinutes: 50
    });

    expect(mapped.afterResources[0]?.overMinutes).toBe(0);
    expect(mapped.summary.remainingOverMinutes).toBe(0);
    expect(mapped.summary.selectedCount).toBe(1);
  });
});
