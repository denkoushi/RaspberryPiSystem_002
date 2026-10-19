import type { ProcedureManualLastApprovalDto, ProcedureManualUsageDto } from './assemblyProcedureDocumentTypes';
import type { AssemblyProcedureSequenceDto } from './assemblyProcedureSequenceTypes';

export type ProcedureManualProcessDto = {
  subjectKind: 'MODEL' | 'PART' | 'COMMON';
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  active: boolean;
  resourceCd: string | null;
};

export type ProcedureManualModelDto = { modelCode: string; modelCodeKey: string };

export type ProcedureManualAssignmentInput = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  sortOrder: number;
  label?: string | null;
};

export type ProcedureManualAssignmentDto = ProcedureManualAssignmentInput & {
  id: string;
  modelCode: string;
  modelCodeKey: string;
  processId: string;
  resolvedDocumentId: string | null;
  unavailableReason: 'no_published_revision' | 'disabled' | null;
};

export type ProcedureManualDetailDto = {
  assignments: ProcedureManualAssignmentDto[];
  sequence: AssemblyProcedureSequenceDto;
};

export type ProcedureManualOverviewItemDto = {
  otherAssignments: ProcedureManualUsageDto[];
  assignmentId: string;
  sortOrder: number;
  label: string | null;
  kind: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  title: string;
  status: 'published' | 'draft' | 'unavailable';
  publishedRevisionNumber: number | null;
  approval: ProcedureManualLastApprovalDto | null;
  draftRevision: { documentId: string; revisionNumber: number; editLease: { holderLabel: string; acquiredAt: string } | null } | null;
  unavailableReason: string | null;
  pageCount: number | null;
  thumbnailPageUrl: string | null;
};

export type ProcedureManualAssignmentOverviewItemDto = ProcedureManualOverviewItemDto & ProcedureManualModelDto & { processId: string; subjectKind?: 'COMMON'; category?: string; target?: string; kanaRow?: string | null };

export type ProcedureManualOverviewDto = {
  processes: { processId: string; count: number; items: ProcedureManualAssignmentOverviewItemDto[] }[];
};

export type ProcedureManualModelOverviewDto = ProcedureManualModelDto & {
  processes: { processId: string; count: number; items: ProcedureManualOverviewItemDto[] }[];
};

export type ProcedureManualEditorContext = {
  modelCode: string;
  modelCodeKey: string;
  processId: string;
  processName: string;
  mode: 'fix' | 'make';
};

export type ProcedureManualByPartDto = {
  partNumber: string; partNumberKey: string;
  processes: { processId: string; processName: string; sequence: AssemblyProcedureSequenceDto }[];
};

export type ProcedureManualCommonCatalogDto = {
  categories: (ProcedureManualProcessDto & { count: number; inUse: boolean })[];
  actions: { id: string; name: string; sortOrder: number; inUse: boolean }[];
  subjects: { key: string; name: string; kanaRow: string | null; categoryIds: string[] }[];
};
