import { describe, expect, it } from 'vitest';

import { measuringInstrumentsQueryKeys } from './measuringInstruments';

describe('measuringInstrumentsQueryKeys', () => {
  it('preserves invalidation prefixes', () => {
    expect(measuringInstrumentsQueryKeys.instrumentsAll).toEqual(['measuring-instruments']);
    expect(measuringInstrumentsQueryKeys.genresAll).toEqual(['measuring-instrument-genres']);
  });

  it('preserves instruments values and arity', () => {
    expect(measuringInstrumentsQueryKeys.instruments({ search: 'instrument', status: 'AVAILABLE' })).toEqual(['measuring-instruments', { search: 'instrument', status: 'AVAILABLE' }]);
    expect(measuringInstrumentsQueryKeys.instruments({})).toEqual(['measuring-instruments', {}]);
    expect(measuringInstrumentsQueryKeys.instruments(undefined)).toEqual(['measuring-instruments', undefined]);
    expect(measuringInstrumentsQueryKeys.instruments()).toEqual(['measuring-instruments', undefined]);
    expect(measuringInstrumentsQueryKeys.instruments({ search: '' })).toEqual(['measuring-instruments', { search: '' }]);
  });

  it('preserves instrument values and arity', () => {
    expect(measuringInstrumentsQueryKeys.instrument('id-1')).toEqual(['measuring-instrument', 'id-1']);
    expect(measuringInstrumentsQueryKeys.instrument('')).toEqual(['measuring-instrument', '']);
    expect(measuringInstrumentsQueryKeys.instrument(undefined)).toEqual(['measuring-instrument', undefined]);
    expect(measuringInstrumentsQueryKeys.instrument()).toEqual(['measuring-instrument', undefined]);
  });

  it('preserves inspectionItems values and arity', () => {
    expect(measuringInstrumentsQueryKeys.inspectionItems('id-1')).toEqual(['inspection-items', 'id-1']);
    expect(measuringInstrumentsQueryKeys.inspectionItems('')).toEqual(['inspection-items', '']);
    expect(measuringInstrumentsQueryKeys.inspectionItems(undefined)).toEqual(['inspection-items', undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionItems()).toEqual(['inspection-items', undefined]);
  });

  it('preserves genreInspectionItems values and arity', () => {
    expect(measuringInstrumentsQueryKeys.genreInspectionItems('id-1')).toEqual(['genre-inspection-items', 'id-1']);
    expect(measuringInstrumentsQueryKeys.genreInspectionItems('')).toEqual(['genre-inspection-items', '']);
    expect(measuringInstrumentsQueryKeys.genreInspectionItems(undefined)).toEqual(['genre-inspection-items', undefined]);
    expect(measuringInstrumentsQueryKeys.genreInspectionItems()).toEqual(['genre-inspection-items', undefined]);
  });

  it('preserves inspectionProfile values and arity', () => {
    expect(measuringInstrumentsQueryKeys.inspectionProfile('id-1')).toEqual(['measuring-instrument-inspection-profile', 'id-1']);
    expect(measuringInstrumentsQueryKeys.inspectionProfile('')).toEqual(['measuring-instrument-inspection-profile', '']);
    expect(measuringInstrumentsQueryKeys.inspectionProfile(undefined)).toEqual(['measuring-instrument-inspection-profile', undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionProfile()).toEqual(['measuring-instrument-inspection-profile', undefined]);
  });

  it('preserves instrumentTags values and arity', () => {
    expect(measuringInstrumentsQueryKeys.instrumentTags('id-1')).toEqual(['instrument-tags', 'id-1']);
    expect(measuringInstrumentsQueryKeys.instrumentTags('')).toEqual(['instrument-tags', '']);
    expect(measuringInstrumentsQueryKeys.instrumentTags(undefined)).toEqual(['instrument-tags', undefined]);
    expect(measuringInstrumentsQueryKeys.instrumentTags()).toEqual(['instrument-tags', undefined]);
  });

  it('preserves inspectionRecordsForInstrument values and arity', () => {
    expect(measuringInstrumentsQueryKeys.inspectionRecordsForInstrument('instrument-1')).toEqual(['inspection-records', 'instrument-1']);
    expect(measuringInstrumentsQueryKeys.inspectionRecordsForInstrument('')).toEqual(['inspection-records', '']);
  });

  it('preserves inspectionRecords values and arity', () => {
    expect(measuringInstrumentsQueryKeys.inspectionRecords('instrument-1', { startDate: '2026-10-01', endDate: '2026-10-19', employeeId: 'employee-1', result: 'PASS' })).toEqual(['inspection-records', 'instrument-1', { startDate: '2026-10-01', endDate: '2026-10-19', employeeId: 'employee-1', result: 'PASS' }]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords()).toEqual(['inspection-records', undefined, undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords(undefined, undefined)).toEqual(['inspection-records', undefined, undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords('instrument-1')).toEqual(['inspection-records', 'instrument-1', undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords('instrument-1', undefined)).toEqual(['inspection-records', 'instrument-1', undefined]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords('', {})).toEqual(['inspection-records', '', {}]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords(undefined, {})).toEqual(['inspection-records', undefined, {}]);
    expect(measuringInstrumentsQueryKeys.inspectionRecords('', { startDate: '', endDate: '', employeeId: '', result: '' })).toEqual(['inspection-records', '', { startDate: '', endDate: '', employeeId: '', result: '' }]);
  });

  it('preserves loanAnalytics values and arity', () => {
    expect(measuringInstrumentsQueryKeys.loanAnalytics({ periodFrom: '2026-10-01', periodTo: '2026-10-19', monthlyMonths: 6, timeZone: 'Asia/Tokyo', measuringInstrumentId: 'id-1' })).toEqual(['measuring-instrument-loan-analytics', { periodFrom: '2026-10-01', periodTo: '2026-10-19', monthlyMonths: 6, timeZone: 'Asia/Tokyo', measuringInstrumentId: 'id-1' }]);
    expect(measuringInstrumentsQueryKeys.loanAnalytics({})).toEqual(['measuring-instrument-loan-analytics', {}]);
    expect(measuringInstrumentsQueryKeys.loanAnalytics(undefined)).toEqual(['measuring-instrument-loan-analytics', {}]);
    expect(measuringInstrumentsQueryKeys.loanAnalytics()).toEqual(['measuring-instrument-loan-analytics', {}]);
    expect(measuringInstrumentsQueryKeys.loanAnalytics({ periodFrom: '', periodTo: '', monthlyMonths: 0, timeZone: 'UTC', measuringInstrumentId: '' })).toEqual(['measuring-instrument-loan-analytics', { periodFrom: '', periodTo: '', monthlyMonths: 0, timeZone: 'UTC', measuringInstrumentId: '' }]);
  });
});
