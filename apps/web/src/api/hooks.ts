// Facade: re-exports all symbols from hook domain modules (hooks split).
// Existing `import ... from '../api/hooks'` paths remain unchanged.

export * from './hooks/tools';
export * from './hooks/kiosk';
export * from './hooks/part-measurement';
export * from './hooks/production-schedule';
export * from './hooks/measuring-instruments';
export * from './hooks/clients';
export * from './hooks/system';
export * from './hooks/signage';
export * from './hooks/kiosk-documents';
export * from './hooks/csv-visualization';
export * from './hooks/rigging';
export * from './hooks/backup';
