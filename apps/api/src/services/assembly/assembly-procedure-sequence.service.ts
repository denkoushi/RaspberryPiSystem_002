import { prisma } from '../../lib/prisma.js';
import { PdfStorageRenderAdapter } from '../kiosk-documents/adapters/pdf-storage-render.adapter.js';
import {
  AssemblyProcedureOrderService,
  type AssemblyProcedureOrderDocumentType,
  type AssemblyProcedureOrderItemSummary
} from './assembly-procedure-order.service.js';

export type AssemblyProcedureSequenceFallbackReason = 'not_configured' | 'no_enabled_documents' | 'no_page_images';

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
      documents: [];
      fallbackProcedureDocument: {
        id: string;
        name: string;
        imageRelativePath: string;
      } | null;
    };

async function toSequenceDocument(
  item: AssemblyProcedureOrderItemSummary,
  render: PdfStorageRenderAdapter
): Promise<AssemblyProcedureSequenceDocument> {
  if (item.documentType === 'assembly_procedure_document') {
    const imageRelativePath = item.document.imageRelativePath;
    return {
      orderItemId: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: item.documentType,
      kioskDocumentId: null,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      title: item.document.title,
      displayTitle: item.document.displayTitle,
      filename: item.document.filename,
      confirmedDocumentNumber: item.document.confirmedDocumentNumber,
      confirmedSummaryText: item.document.confirmedSummaryText,
      pageCount: item.document.pageCount,
      updatedAt: item.document.updatedAt,
      pageUrls: imageRelativePath ? [imageRelativePath] : []
    };
  }

  const filePath = item.document.filePath;
  if (!filePath) {
    return {
      orderItemId: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: item.documentType,
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: null,
      title: item.document.title,
      displayTitle: item.document.displayTitle,
      filename: item.document.filename,
      confirmedDocumentNumber: item.document.confirmedDocumentNumber,
      confirmedSummaryText: item.document.confirmedSummaryText,
      pageCount: item.document.pageCount,
      updatedAt: item.document.updatedAt,
      pageUrls: []
    };
  }

  const pageUrls = await render.convertPdfToPageUrls(item.document.id, filePath);
  return {
    orderItemId: item.id,
    sortOrder: item.sortOrder,
    label: item.label,
    documentType: item.documentType,
    kioskDocumentId: item.kioskDocumentId,
    assemblyProcedureDocumentId: null,
    title: item.document.title,
    displayTitle: item.document.displayTitle,
    filename: item.document.filename,
    confirmedDocumentNumber: item.document.confirmedDocumentNumber,
    confirmedSummaryText: item.document.confirmedSummaryText,
    pageCount: item.document.pageCount,
    updatedAt: item.document.updatedAt,
    pageUrls
  };
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
      return {
        mode: 'fallback',
        reason: 'not_configured',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents: [],
        fallbackProcedureDocument
      };
    }

    const enabledItems = order.items.filter((item) => item.document.enabled);
    if (enabledItems.length === 0) {
      return {
        mode: 'fallback',
        reason: 'no_enabled_documents',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents: [],
        fallbackProcedureDocument
      };
    }

    const documents = (await Promise.all(enabledItems.map((item) => toSequenceDocument(item, this.render)))).filter(
      (document) => document.pageUrls.length > 0
    );
    if (documents.length === 0) {
      return {
        mode: 'fallback',
        reason: 'no_page_images',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents: [],
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
