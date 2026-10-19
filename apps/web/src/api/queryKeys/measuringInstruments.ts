import type {
  getInspectionRecords,
  getMeasuringInstrumentLoanAnalytics,
  getMeasuringInstruments,
} from '../client';

export const measuringInstrumentsQueryKeys = {
  instrumentsAll: ['measuring-instruments'] as const,
  instruments: (params?: Parameters<typeof getMeasuringInstruments>[0]) => ['measuring-instruments', params] as const,
  instrument: (id?: string) => ['measuring-instrument', id] as const,
  genresAll: ['measuring-instrument-genres'] as const,
  inspectionItems: (measuringInstrumentId?: string) => ['inspection-items', measuringInstrumentId] as const,
  genreInspectionItems: (genreId?: string) => ['genre-inspection-items', genreId] as const,
  inspectionProfile: (measuringInstrumentId?: string) =>
    ['measuring-instrument-inspection-profile', measuringInstrumentId] as const,
  instrumentTags: (measuringInstrumentId?: string) => ['instrument-tags', measuringInstrumentId] as const,
  inspectionRecordsForInstrument: (measuringInstrumentId: string) =>
    ['inspection-records', measuringInstrumentId] as const,
  inspectionRecords: (measuringInstrumentId?: string, filters?: Parameters<typeof getInspectionRecords>[1]) =>
    ['inspection-records', measuringInstrumentId, filters] as const,
  loanAnalytics: (params?: Parameters<typeof getMeasuringInstrumentLoanAnalytics>[0]) =>
    ['measuring-instrument-loan-analytics', params ?? {}] as const,
};
