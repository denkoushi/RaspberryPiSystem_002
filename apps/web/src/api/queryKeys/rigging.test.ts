import { describe, expect, it } from 'vitest';

import { riggingQueryKeys } from './rigging';

describe('riggingQueryKeys', () => {
  it('preserves invalidation prefixes', () => {
    expect(riggingQueryKeys.gearsAll).toEqual(['rigging-gears']);
  });

  it('preserves gears values and arity', () => {
    expect(riggingQueryKeys.gears({ search: 'gear', status: 'AVAILABLE' })).toEqual(['rigging-gears', { search: 'gear', status: 'AVAILABLE' }]);
    expect(riggingQueryKeys.gears({})).toEqual(['rigging-gears', {}]);
    expect(riggingQueryKeys.gears(undefined)).toEqual(['rigging-gears', undefined]);
    expect(riggingQueryKeys.gears()).toEqual(['rigging-gears', undefined]);
    expect(riggingQueryKeys.gears({ search: '' })).toEqual(['rigging-gears', { search: '' }]);
  });

  it('preserves inspectionRecords values and arity', () => {
    expect(riggingQueryKeys.inspectionRecords('id-1')).toEqual(['rigging-inspection-records', 'id-1']);
    expect(riggingQueryKeys.inspectionRecords('')).toEqual(['rigging-inspection-records', '']);
    expect(riggingQueryKeys.inspectionRecords(undefined)).toEqual(['rigging-inspection-records', undefined]);
    expect(riggingQueryKeys.inspectionRecords()).toEqual(['rigging-inspection-records', undefined]);
  });

  it('preserves loanAnalytics values and arity', () => {
    expect(riggingQueryKeys.loanAnalytics({ periodFrom: '2026-10-01', periodTo: '2026-10-19', monthlyMonths: 6, timeZone: 'Asia/Tokyo', riggingGearId: 'id-1' })).toEqual(['rigging-loan-analytics', { periodFrom: '2026-10-01', periodTo: '2026-10-19', monthlyMonths: 6, timeZone: 'Asia/Tokyo', riggingGearId: 'id-1' }]);
    expect(riggingQueryKeys.loanAnalytics({})).toEqual(['rigging-loan-analytics', {}]);
    expect(riggingQueryKeys.loanAnalytics(undefined)).toEqual(['rigging-loan-analytics', {}]);
    expect(riggingQueryKeys.loanAnalytics()).toEqual(['rigging-loan-analytics', {}]);
    expect(riggingQueryKeys.loanAnalytics({ periodFrom: '', periodTo: '', monthlyMonths: 0, timeZone: 'UTC', riggingGearId: '' })).toEqual(['rigging-loan-analytics', { periodFrom: '', periodTo: '', monthlyMonths: 0, timeZone: 'UTC', riggingGearId: '' }]);
  });
});
