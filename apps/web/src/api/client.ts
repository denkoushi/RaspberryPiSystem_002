// Facade: re-exports all symbols from domain modules (Step W2 split).
// Existing `import ... from '../api/client'` paths remain unchanged.

export {
  DEFAULT_CLIENT_KEY,
  api,
  getResolvedClientKey,
  setAuthToken,
  setClientKeyHeader,
  getWebSocketUrl,
} from './http';

export * from './domains/auth';
export * from './domains/tools';
export * from './domains/kiosk';
export * from './domains/production-schedule';
export * from './domains/mobile-placement';
export * from './domains/measuring-instruments';
export * from './domains/rigging';
export * from './domains/part-measurement';
export * from './domains/clients';
export * from './domains/system';
export * from './domains/signage';
export * from './domains/kiosk-documents';
export * from './domains/csv-visualization';
export * from './domains/assembly';

// Compatibility re-exports: feature types (do not add new ones)
export type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureDocumentSummaryDto,
  AssemblySeibanCandidateDto,
  AssemblyTemplateDto,
  AssemblyTemplateSummaryDto,
  AssemblyWorkSessionDto,
  AssemblyWorkSessionSummaryDto
} from '../features/assembly/types';

export type {
  FindOrOpenPartMeasurementResponse,
  PartMeasurementProcessGroup,
  PartMeasurementSheetDto,
  PartMeasurementSheetWithSession,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateScope,
  PartMeasurementVisualTemplateDto,
  ResolveTicketResponse
} from '../features/part-measurement/types';
