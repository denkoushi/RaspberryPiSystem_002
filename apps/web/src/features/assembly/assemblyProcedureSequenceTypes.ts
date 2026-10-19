import type { AssemblyProcedureOverlayAssetDto, ProcedureManualLastApprovalDto } from './assemblyProcedureDocumentTypes';
import type { ProcedureVideoSummaryDto } from './procedure-manuals/procedure-video-types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type AssemblyProcedureSequenceDocumentSummaryDto = {
  id: string;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  enabled: boolean;
  updatedAt: string;
  imageRelativePath: string | null;
};

export type AssemblyProcedureSequenceItemDto = {
  id: string;
  sortOrder: number;
  label: string | null;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  document: AssemblyProcedureSequenceDocumentSummaryDto;
};

export type AssemblyProcedureSequencePageDto = {
  videos?: ProcedureVideoSummaryDto[];
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
  pageUrl: string;
  overlays?: AssemblyProcedureOverlayElement[];
};

export type AssemblyProcedureStepSourceDto = 'template_steps' | 'document_expansion';
export type AssemblyProcedureStepViewModeDto = 'full_page' | 'crop';
export type AssemblyProcedureStepEmphasisDto = 'normal' | 'important' | 'caution';

export type AssemblyTemplateProcedureStepDto = {
  id: string;
  sortOrder: number;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
  viewMode: AssemblyProcedureStepViewModeDto;
  cropXRatio: number | null;
  cropYRatio: number | null;
  cropWidthRatio: number | null;
  cropHeightRatio: number | null;
  title: string | null;
  instructionText: string | null;
  emphasis: AssemblyProcedureStepEmphasisDto;
};

export type AssemblyProcedureSequenceStepDto = AssemblyTemplateProcedureStepDto & {
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  documentTitle: string;
  pageUrl: string;
};

export type AssemblyProcedureSequenceDocumentDto = {
  lastApproval?: ProcedureManualLastApprovalDto | null;
  orderItemId: string;
  sortOrder: number;
  label: string | null;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  updatedAt: string;
  pageUrls: string[];
  pages: AssemblyProcedureSequencePageDto[];
  overlays?: AssemblyProcedureOverlayElement[];
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
};

export type AssemblyProcedureSequenceDto = {
  mode: 'configured' | 'fallback';
  source: 'template_version' | 'legacy_machine_order' | 'primary_fallback';
  reason: 'not_configured' | 'no_enabled_documents' | 'no_page_images' | null;
  machineName: string;
  machineNameKey: string;
  documents: AssemblyProcedureSequenceDocumentDto[];
  stepSource?: AssemblyProcedureStepSourceDto;
  steps?: AssemblyProcedureSequenceStepDto[];
  fallbackProcedureDocument: {
    id: string;
    name: string;
    imageRelativePath: string;
  } | null;
};
