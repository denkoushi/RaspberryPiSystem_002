import { ApiError } from '../../lib/errors.js';

export type AssemblyProcedureSequenceDocumentType =
  | 'kiosk_document'
  | 'assembly_procedure_document';

export type AssemblyProcedureSequenceDocumentSummary = {
  id: string;
  documentType: AssemblyProcedureSequenceDocumentType;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  enabled: boolean;
  status: 'draft' | 'published' | null;
  updatedAt: Date;
  filePath: string | null;
  imageRelativePath: string | null;
};

export type AssemblyProcedureSequenceItemSummary = {
  id: string;
  sortOrder: number;
  label: string | null;
  documentType: AssemblyProcedureSequenceDocumentType;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  document: AssemblyProcedureSequenceDocumentSummary;
};

export const assemblyProcedureSequenceKioskDocumentSelect = {
  id: true,
  title: true,
  displayTitle: true,
  filename: true,
  confirmedDocumentNumber: true,
  confirmedSummaryText: true,
  pageCount: true,
  enabled: true,
  updatedAt: true,
  filePath: true
} as const;

export const assemblyProcedureSequenceAssemblyDocumentSelect = {
  id: true,
  name: true,
  imageRelativePath: true,
  isActive: true,
  status: true,
  updatedAt: true,
  pages: {
    orderBy: { pageIndex: 'asc' as const },
    select: { pageIndex: true, imageRelativePath: true }
  }
} as const;

type ProcedureSequenceItemLike = {
  id: string;
  sortOrder: number;
  label: string | null;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  kioskDocument: {
    id: string;
    title: string;
    displayTitle: string | null;
    filename: string;
    confirmedDocumentNumber: string | null;
    confirmedSummaryText: string | null;
    pageCount: number | null;
    enabled: boolean;
    updatedAt: Date;
    filePath: string;
  } | null;
  assemblyProcedureDocument: {
    id: string;
    name: string;
    imageRelativePath: string;
    isActive: boolean;
    status: 'DRAFT' | 'PUBLISHED';
    updatedAt: Date;
    pages: Array<{ pageIndex: number; imageRelativePath: string }>;
  } | null;
};

export function mapAssemblyProcedureSequenceItem(
  item: ProcedureSequenceItemLike
): AssemblyProcedureSequenceItemSummary {
  if (item.kioskDocument && item.kioskDocumentId) {
    const document = item.kioskDocument;
    return {
      id: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: 'kiosk_document',
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: null,
      document: {
        id: document.id,
        documentType: 'kiosk_document',
        title: document.title,
        displayTitle: document.displayTitle,
        filename: document.filename,
        confirmedDocumentNumber: document.confirmedDocumentNumber,
        confirmedSummaryText: document.confirmedSummaryText,
        pageCount: document.pageCount,
        enabled: document.enabled,
        status: null,
        updatedAt: document.updatedAt,
        filePath: document.filePath,
        imageRelativePath: null
      }
    };
  }

  if (item.assemblyProcedureDocument && item.assemblyProcedureDocumentId) {
    const document = item.assemblyProcedureDocument;
    return {
      id: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      document: {
        id: document.id,
        documentType: 'assembly_procedure_document',
        title: document.name,
        displayTitle: null,
        filename: document.name,
        confirmedDocumentNumber: null,
        confirmedSummaryText: null,
        pageCount: document.pages.length > 0 ? document.pages.length : 1,
        enabled: document.isActive,
        status: document.status === 'PUBLISHED' ? 'published' : 'draft',
        updatedAt: document.updatedAt,
        filePath: null,
        imageRelativePath: document.imageRelativePath
      }
    };
  }

  throw new ApiError(500, '組立手順書列の参照先が不正です');
}
