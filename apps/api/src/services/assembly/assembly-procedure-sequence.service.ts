import { prisma } from '../../lib/prisma.js';
import { PdfStorageRenderAdapter } from '../kiosk-documents/adapters/pdf-storage-render.adapter.js';
import {
  AssemblyProcedureOrderService,
  type AssemblyProcedureOrderDocumentType,
  type AssemblyProcedureOrderItemSummary
} from './assembly-procedure-order.service.js';

export type AssemblyProcedureSequenceFallbackReason = 'not_configured' | 'no_enabled_documents' | 'no_page_images';

export type AssemblyProcedureSequencePage = {
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
  pageUrl: string;
};

export type AssemblyProcedureSequenceDocument = {
  orderItemId: string;
  sortOrder: number;
  label: string | null;
  documentType: AssemblyProcedureOrderDocumentType;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  updatedAt: Date;
  pageUrls: string[];
  pages: AssemblyProcedureSequencePage[];
};

export type AssemblyProcedureSequence =
  | {
      mode: 'configured';
      machineName: string;
      machineNameKey: string;
      documents: AssemblyProcedureSequenceDocument[];
      fallbackProcedureDocument: {
        id: string;
        name: string;
        imageRelativePath: string;
      } | null;
    }
  | {
      mode: 'fallback';
      reason: AssemblyProcedureSequenceFallbackReason;
      machineName: string;
      machineNameKey: string;
      documents: AssemblyProcedureSequenceDocument[];
      fallbackProcedureDocument: {
        id: string;
        name: string;
        imageRelativePath: string;
      } | null;
    };

function buildAssemblyProcedurePages(
  documentId: string,
  pages: Array<{ pageIndex: number; imageRelativePath: string }>
): AssemblyProcedureSequencePage[] {
  return pages.map((page) => ({
    source: 'assembly_procedure_document' as const,
    documentId,
    pageIndex: page.pageIndex,
    pageUrl: page.imageRelativePath
  }));
}

function buildKioskProcedurePages(documentId: string, pageUrls: string[]): AssemblyProcedureSequencePage[] {
  return pageUrls.map((pageUrl, index) => ({
    source: 'kiosk_document' as const,
    documentId,
    pageIndex: index,
    pageUrl
  }));
}

async function toSequenceDocument(
  item: AssemblyProcedureOrderItemSummary,
  render: PdfStorageRenderAdapter,
  assemblyPagesByDocumentId: Map<string, Array<{ pageIndex: number; imageRelativePath: string }>>
): Promise<AssemblyProcedureSequenceDocument | null> {
  if (item.documentType === 'assembly_procedure_document') {
    if (item.document.status === 'draft') return null;
    const assemblyProcedureDocumentId = item.assemblyProcedureDocumentId;
    if (!assemblyProcedureDocumentId) return null;
    const storedPages = assemblyPagesByDocumentId.get(assemblyProcedureDocumentId) ?? [];
    const pages =
      storedPages.length > 0
        ? buildAssemblyProcedurePages(assemblyProcedureDocumentId, storedPages)
        : item.document.imageRelativePath
          ? buildAssemblyProcedurePages(assemblyProcedureDocumentId, [
              { pageIndex: 0, imageRelativePath: item.document.imageRelativePath }
            ])
          : [];
    const pageUrls = pages.map((page) => page.pageUrl);
    return {
      orderItemId: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: item.documentType,
      kioskDocumentId: null,
      assemblyProcedureDocumentId,
      title: item.document.title,
      displayTitle: item.document.displayTitle,
      filename: item.document.filename,
      confirmedDocumentNumber: item.document.confirmedDocumentNumber,
      confirmedSummaryText: item.document.confirmedSummaryText,
      pageCount: item.document.pageCount,
      updatedAt: item.document.updatedAt,
      pageUrls,
      pages
    };
  }

  const kioskDocumentId = item.kioskDocumentId;
  if (!kioskDocumentId) return null;
  const filePath = item.document.filePath;
  if (!filePath) {
    return {
      orderItemId: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: item.documentType,
      kioskDocumentId,
      assemblyProcedureDocumentId: null,
      title: item.document.title,
      displayTitle: item.document.displayTitle,
      filename: item.document.filename,
      confirmedDocumentNumber: item.document.confirmedDocumentNumber,
      confirmedSummaryText: item.document.confirmedSummaryText,
      pageCount: item.document.pageCount,
      updatedAt: item.document.updatedAt,
      pageUrls: [],
      pages: []
    };
  }

  const pageUrls = await render.convertPdfToPageUrls(item.document.id, filePath);
  const pages = buildKioskProcedurePages(kioskDocumentId, pageUrls);
  return {
    orderItemId: item.id,
    sortOrder: item.sortOrder,
    label: item.label,
    documentType: item.documentType,
    kioskDocumentId,
    assemblyProcedureDocumentId: null,
    title: item.document.title,
    displayTitle: item.document.displayTitle,
    filename: item.document.filename,
    confirmedDocumentNumber: item.document.confirmedDocumentNumber,
    confirmedSummaryText: item.document.confirmedSummaryText,
    pageCount: item.document.pageCount,
    updatedAt: item.document.updatedAt,
    pageUrls,
    pages
  };
}

async function buildFallbackSequenceDocuments(
  procedureDocumentId: string | null | undefined
): Promise<AssemblyProcedureSequenceDocument[]> {
  if (!procedureDocumentId) return [];
  const doc = await prisma.assemblyProcedureDocument.findUnique({
    where: { id: procedureDocumentId },
    select: {
      id: true,
      name: true,
      imageRelativePath: true,
      status: true,
      isActive: true,
      updatedAt: true,
      pages: {
        orderBy: { pageIndex: 'asc' },
        select: { pageIndex: true, imageRelativePath: true }
      }
    }
  });
  if (!doc || !doc.isActive || doc.status !== 'PUBLISHED') return [];

  const pages =
    doc.pages.length > 0
      ? buildAssemblyProcedurePages(doc.id, doc.pages)
      : buildAssemblyProcedurePages(doc.id, [{ pageIndex: 0, imageRelativePath: doc.imageRelativePath }]);
  if (pages.length === 0) return [];

  return [
    {
      orderItemId: '',
      sortOrder: 0,
      label: null,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: doc.id,
      title: doc.name,
      displayTitle: null,
      filename: doc.name,
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: pages.length,
      updatedAt: doc.updatedAt,
      pageUrls: pages.map((page) => page.pageUrl),
      pages
    }
  ];
}

export class AssemblyProcedureSequenceService {
  constructor(
    private readonly orderService = new AssemblyProcedureOrderService(),
    private readonly render = new PdfStorageRenderAdapter()
  ) {}

  async resolveForWorkSession(sessionId: string): Promise<AssemblyProcedureSequence | null> {
    const session = await prisma.assemblyWorkSession.findUnique({
      where: { id: sessionId },
      select: {
        targetUnit: true,
        template: {
          select: {
            procedureDocument: {
              select: {
                id: true,
                name: true,
                imageRelativePath: true
              }
            }
          }
        }
      }
    });
    if (!session) return null;

    const order = await this.orderService.getByMachineName(session.targetUnit);
    const fallbackProcedureDocument = session.template.procedureDocument ?? null;
    if (order.items.length === 0) {
      const documents = await buildFallbackSequenceDocuments(fallbackProcedureDocument?.id);
      return {
        mode: 'fallback',
        reason: documents.length > 0 ? 'not_configured' : 'not_configured',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents,
        fallbackProcedureDocument
      };
    }

    const enabledItems = order.items.filter((item) => {
      if (!item.document.enabled) return false;
      if (item.documentType === 'assembly_procedure_document' && item.document.status === 'draft') return false;
      return true;
    });
    if (enabledItems.length === 0) {
      const documents = await buildFallbackSequenceDocuments(fallbackProcedureDocument?.id);
      return {
        mode: 'fallback',
        reason: 'no_enabled_documents',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents,
        fallbackProcedureDocument
      };
    }

    const assemblyDocumentIds = [
      ...new Set(
        enabledItems
          .filter((item) => item.documentType === 'assembly_procedure_document' && item.assemblyProcedureDocumentId)
          .map((item) => item.assemblyProcedureDocumentId as string)
      )
    ];
    const assemblyPages = await prisma.assemblyProcedureDocumentPage.findMany({
      where: { documentId: { in: assemblyDocumentIds } },
      orderBy: [{ documentId: 'asc' }, { pageIndex: 'asc' }],
      select: { documentId: true, pageIndex: true, imageRelativePath: true }
    });
    const assemblyPagesByDocumentId = new Map<string, Array<{ pageIndex: number; imageRelativePath: string }>>();
    for (const page of assemblyPages) {
      const current = assemblyPagesByDocumentId.get(page.documentId) ?? [];
      current.push({ pageIndex: page.pageIndex, imageRelativePath: page.imageRelativePath });
      assemblyPagesByDocumentId.set(page.documentId, current);
    }

    const documents = (
      await Promise.all(enabledItems.map((item) => toSequenceDocument(item, this.render, assemblyPagesByDocumentId)))
    ).filter((document): document is AssemblyProcedureSequenceDocument => document != null && document.pages.length > 0);
    if (documents.length === 0) {
      const fallbackDocuments = await buildFallbackSequenceDocuments(fallbackProcedureDocument?.id);
      return {
        mode: 'fallback',
        reason: 'no_page_images',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents: fallbackDocuments,
        fallbackProcedureDocument
      };
    }

    return {
      mode: 'configured',
      machineName: order.machineName,
      machineNameKey: order.machineNameKey,
      documents,
      fallbackProcedureDocument
    };
  }
}
