import { describe, expect, it } from 'vitest';

import { reportsQueryKeys } from './reports';

describe('reportsQueryKeys', () => {
  it('preserves loan report parameters and boundary values', () => {
    expect(reportsQueryKeys.loanReportPreview({ category: 'tools', periodFrom: '2026-10-01' })).toEqual(['loan-report-preview', { category: 'tools', periodFrom: '2026-10-01' }]);
    expect(Reflect.apply(reportsQueryKeys.loanReportPreview, undefined, [])).toEqual(['loan-report-preview', undefined]);
    expect(Reflect.apply(reportsQueryKeys.loanReportPreview, undefined, [undefined])).toEqual(['loan-report-preview', undefined]);
    expect(Reflect.apply(reportsQueryKeys.loanReportPreview, undefined, [null])).toEqual(['loan-report-preview', null]);
    expect(Reflect.apply(reportsQueryKeys.loanReportPreview, undefined, [{}])).toEqual(['loan-report-preview', {}]);
  });

  it('preserves item analytics parameters and the nullish default', () => {
    expect(reportsQueryKeys.itemLoanAnalytics({ itemId: 'item-1', timeZone: 'Asia/Tokyo' })).toEqual(['item-loan-analytics', { itemId: 'item-1', timeZone: 'Asia/Tokyo' }]);
    expect(reportsQueryKeys.itemLoanAnalytics()).toEqual(['item-loan-analytics', {}]);
    expect(reportsQueryKeys.itemLoanAnalytics(undefined)).toEqual(['item-loan-analytics', {}]);
    expect(Reflect.apply(reportsQueryKeys.itemLoanAnalytics, undefined, [null])).toEqual(['item-loan-analytics', {}]);
    expect(reportsQueryKeys.itemLoanAnalytics({})).toEqual(['item-loan-analytics', {}]);
  });
});
