import type { ProcedureVideoSummaryDto } from './procedure-manuals/procedure-video-types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type AssemblyProcedureOverlayAssetDto = {
  assetId: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  url?: string;
  relativeUrl?: string;
  sha256?: string;
  kind?: 'OVERLAY_IMAGE';
};

export type AssemblyProcedureTextCandidateDto = {
  text: string;
  confidence: number | null;
  bounds: {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
  } | null;
  pageIndex: number | null;
  source: 'coordinate-ocr' | 'poppler' | 'none' | string;
};

export type AssemblyProcedureDocumentStatusDto = 'draft' | 'published';

export type AssemblyProcedureDocumentPageDto = {
  videos?: ProcedureVideoSummaryDto[];
  pageIndex: number;
  imageRelativePath: string;
  assetId?: string | null;
  overlays?: AssemblyProcedureOverlayElement[];
};

export type ProcedureManualLastApprovalDto = { employeeName: string; positionName: string | null; approvedAt: string };

export type AssemblyProcedureDocumentDto = {
  lastApproval?: ProcedureManualLastApprovalDto | null;
  id: string;
  name: string;
  imageRelativePath: string;
  status: AssemblyProcedureDocumentStatusDto;
  publishedAt: string | null;
  isActive: boolean;
  revisionRootId?: string | null;
  revisionNumber?: number;
  supersedesDocumentId?: string | null;
  isRevisionHead?: boolean;
  editVersion?: number;
  sourceAssetId?: string | null;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  pages: AssemblyProcedureDocumentPageDto[];
  createdAt: string;
  updatedAt: string;
};

export type ProcedureManualUsageDto = { modelCode: string; modelCodeKey: string; processId: string; processName: string };

export type AssemblyProcedureDocumentSummaryDto = AssemblyProcedureDocumentDto & {
  manualAssignments: ProcedureManualUsageDto[];
  activeTemplateCount: number;
  totalTemplateCount: number;
};

export type AssemblyProcedureGmailImportItemDto = {
  messageId: string;
  filename: string | null;
  status: 'imported' | 'duplicate' | 'import_failed' | 'cleanup_failed';
  document: AssemblyProcedureDocumentDto | null;
  error: string | null;
};

export type AssemblyProcedureGmailImportResultDto = {
  query: string;
  scanned: number;
  exactMatched: number;
  subjectMismatchSkipped: number;
  attempted: number;
  imported: number;
  duplicates: number;
  trashed: number;
  failed: number;
  remainingInInbox: number;
  items: AssemblyProcedureGmailImportItemDto[];
};
