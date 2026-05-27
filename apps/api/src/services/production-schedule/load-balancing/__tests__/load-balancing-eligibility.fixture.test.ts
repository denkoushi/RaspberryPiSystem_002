import { describe, expect, it } from 'vitest';

import {
  ALL_FKO_STATUSES,
  isLoadBalancingEligibleRow,
  type LoadBalancingEligibilityFixtureRow
} from './load-balancing-eligibility.fixture.js';

function row(
  partial: Partial<LoadBalancingEligibilityFixtureRow> & Pick<LoadBalancingEligibilityFixtureRow, 'rowId'>
): LoadBalancingEligibilityFixtureRow {
  return {
    fkoStatus: 'S',
    hasFkmail: true,
    isCompleted: false,
    isExternallyCompleted: false,
    ...partial
  };
}

describe('load balancing eligibility (fixture semantics)', () => {
  it('S/R/O/P を含み C/X を除外する', () => {
    const eligible = ALL_FKO_STATUSES.filter((st) =>
      isLoadBalancingEligibleRow(row({ rowId: st, fkoStatus: st }))
    ).sort();

    expect(eligible).toEqual(['O', 'P', 'R', 'S']);
  });

  it('手動完了・外部完了は除外する', () => {
    expect(isLoadBalancingEligibleRow(row({ rowId: 'manual', isCompleted: true }))).toBe(false);
    expect(
      isLoadBalancingEligibleRow(row({ rowId: 'external', isExternallyCompleted: true }))
    ).toBe(false);
  });

  it('fkmail 未同期は除外する', () => {
    expect(isLoadBalancingEligibleRow(row({ rowId: 'no-mail', hasFkmail: false }))).toBe(false);
  });
});
