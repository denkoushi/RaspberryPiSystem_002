import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { PdfStorageRenderAdapter } from '../kiosk-documents/adapters/pdf-storage-render.adapter.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import { AssemblyLegacyProcedureOrderService } from './assembly-legacy-procedure-order.service.js';
import {
  assemblyProcedureAssetUrl,
  serializeAssemblyProcedureOverlayElement,
  type AssemblyProcedureDocumentRevisionDto
} from './assembly-procedure-document-revision.serializer.js';
import {
  type AssemblyProcedureSequenceDocumentType,
  type AssemblyProcedureSequenceItemSummary
} from './assembly-procedure-sequence-item.js';
import {
  assemblyTemplateProcedureItemsInclude,
  mapTemplateProcedureItem,
  type AssemblyTemplateProcedureSequenceSource
} from './assembly-template-procedure-sequence.service.js';
import {
  AssemblyTemplateProcedureStepService,
  assemblyTemplateProcedureStepsInclude,
  type AssemblyTemplateProcedureStepSource,
  type AssemblyTemplateProcedureStepSummary
} from './assembly-template-procedure-step.service.js';

export type AssemblyProcedureSequenceFallbackReason = 'not_configured' | 'no_enabled_documents' | 'no_page_images';

export type AssemblyProcedureSequencePage = {
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
  pageUrl: string;
  overlays: AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays'];
};

export type AssemblyProcedureSequenceAsset = AssemblyProcedureDocumentRevisionDto['assets'][string];

export type AssemblyProcedureSequenceDocument = {
  orderItemId: string;
  sortOrder: number;
  label: string | null;
  documentType: AssemblyProcedureSequenceDocumentType;
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
  overlays: AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays'];
  assets: Record<string, AssemblyProcedureSequenceAsset>;
};

export type AssemblyProcedureSequenceStep = AssemblyTemplateProcedureStepSummary & {
  documentType: AssemblyProcedureSequenceDocumentType;
  documentTitle: string;
  pageUrl: string;
};

export type AssemblyProcedureSequence =
  | {
      mode: 'configured';
      source: AssemblyTemplateProcedureSequenceSource;
      machineName: string;
      machineNameKey: string;
      documents: AssemblyProcedureSequenceDocument[];
      stepSource: AssemblyTemplateProcedureStepSource;
      steps: AssemblyProcedureSequenceStep[];
      fallbackProcedureDocument: {
        id: string;
        name: string;
        imageRelativePath: string;
      } | null;
    }
  | {
      mode: 'fallback';
      source: AssemblyTemplateProcedureSequenceSource;
      reason: AssemblyProcedureSequenceFallbackReason;
      machineName: string;
      machineNameKey: string;
      documents: AssemblyProcedureSequenceDocument[];
      stepSource: AssemblyTemplateProcedureStepSource;
      steps: AssemblyProcedureSequenceStep[];
      fallbackProcedureDocument: {
        id: string;
        name: string;
        imageRelativePath: string;
      } | null;
    };

function buildAssemblyProcedurePages(
  documentId: string,
  pages: Array<{ pageIndex: number; imageRelativePath: string }>,
  overlaysByPage: ReadonlyMap<
    number,
    AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays']
  > = new Map()
): AssemblyProcedureSequencePage[] {
  return pages.map((page) => ({
    source: 'assembly_procedure_document' as const,
    documentId,
    pageIndex: page.pageIndex,
    pageUrl: page.imageRelativePath,
    overlays: overlaysByPage.get(page.pageIndex) ?? []
  }));
}

function buildKioskProcedurePages(documentId: string, pageUrls: string[]): AssemblyProcedureSequencePage[] {
  return pageUrls.map((pageUrl, index) => ({
    source: 'kiosk_document' as const,
    documentId,
    pageIndex: index,
    pageUrl,
    overlays: []
  }));
}

type AssemblyProcedureOverlayRow = Parameters<typeof serializeAssemblyProcedureOverlayElement>[0];

function buildOverlayProjection(rows: AssemblyProcedureOverlayRow[]): {
  overlays: AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays'];
  overlaysByPage: Map<number, AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays']>;
  assets: Record<string, AssemblyProcedureSequenceAsset>;
} {
  const overlays = rows.map((row) => serializeAssemblyProcedureOverlayElement(row));
  const overlaysByPage = new Map<
    number,
    AssemblyProcedureDocumentRevisionDto['pages'][number]['overlays']
  >();
  const assets: Record<string, AssemblyProcedureSequenceAsset> = {};

  for (const row of rows) {
    if (!row.asset) continue;
    assets[row.asset.id] = {
      assetId: row.asset.id,
      storageKey: row.asset.storageKey,
      contentType: row.asset.contentType,
      byteSize: row.asset.byteSize,
      url: assemblyProcedureAssetUrl(row.asset.id, row.asset.storageKey)
    };
  }

  for (const overlay of overlays) {
    const values = overlaysByPage.get(overlay.pageIndex) ?? [];
    values.push(overlay);
    overlaysByPage.set(overlay.pageIndex, values);
  }

  return { overlays, overlaysByPage, assets };
}

async function toSequenceDocument(
  item: AssemblyProcedureSequenceItemSummary,
  render: PdfStorageRenderAdapter,
  assemblyPagesByDocumentId: Map<string, Array<{ pageIndex: number; imageRelativePath: string }>>,
  assemblyOverlaysByDocumentId: Map<string, AssemblyProcedureOverlayRow[]>
): Promise<AssemblyProcedureSequenceDocument | null> {
  if (item.documentType === 'assembly_procedure_document') {
    if (item.document.status === 'draft') return null;
    const assemblyProcedureDocumentId = item.assemblyProcedureDocumentId;
    if (!assemblyProcedureDocumentId) return null;
    const storedPages = assemblyPagesByDocumentId.get(assemblyProcedureDocumentId) ?? [];
    const overlayProjection = buildOverlayProjection(
      assemblyOverlaysByDocumentId.get(assemblyProcedureDocumentId) ?? []
    );
    const pages =
      storedPages.length > 0
        ? buildAssemblyProcedurePages(
            assemblyProcedureDocumentId,
            storedPages,
            overlayProjection.overlaysByPage
          )
        : item.document.imageRelativePath
          ? buildAssemblyProcedurePages(assemblyProcedureDocumentId, [
              { pageIndex: 0, imageRelativePath: item.document.imageRelativePath }
            ], overlayProjection.overlaysByPage)
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
      pages,
      overlays: overlayProjection.overlays,
      assets: overlayProjection.assets
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
      pages: [],
      overlays: [],
      assets: {}
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
    pages,
    overlays: [],
    assets: {}
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
      },
      overlayElements: {
        orderBy: [
          { pageIndex: 'asc' },
          { zIndex: 'asc' },
          { createdAt: 'asc' }
        ],
        include: { asset: true }
      }
    }
  });
  if (!doc || !doc.isActive || doc.status !== 'PUBLISHED') return [];

  const overlayProjection = buildOverlayProjection(doc.overlayElements);
  const pages =
    doc.pages.length > 0
      ? buildAssemblyProcedurePages(doc.id, doc.pages, overlayProjection.overlaysByPage)
      : buildAssemblyProcedurePages(
          doc.id,
          [{ pageIndex: 0, imageRelativePath: doc.imageRelativePath }],
          overlayProjection.overlaysByPage
        );
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
      pages,
      overlays: overlayProjection.overlays,
      assets: overlayProjection.assets
    }
  ];
}

function buildProcedureSteps(
  documents: AssemblyProcedureSequenceDocument[],
  storedSteps: AssemblyTemplateProcedureStepSummary[]
): {
  stepSource: AssemblyTemplateProcedureStepSource;
  steps: AssemblyProcedureSequenceStep[];
} {
  const documentsByKey = new Map(
    documents.map((document) => [
      document.kioskDocumentId
        ? `kiosk_document:${document.kioskDocumentId}`
        : `assembly_procedure_document:${document.assemblyProcedureDocumentId}`,
      document
    ])
  );
  if (storedSteps.length > 0) {
    return {
      stepSource: 'template_steps',
      steps: storedSteps.flatMap((step) => {
        const key = step.kioskDocumentId
          ? `kiosk_document:${step.kioskDocumentId}`
          : `assembly_procedure_document:${step.assemblyProcedureDocumentId}`;
        const document = documentsByKey.get(key);
        const page = document?.pages.find((candidate) => candidate.pageIndex === step.pageIndex);
        if (!document || !page) return [];
        return [
          {
            ...step,
            documentType: document.documentType,
            documentTitle: document.displayTitle || document.title,
            pageUrl: page.pageUrl
          }
        ];
      })
    };
  }
  let sortOrder = 0;
  return {
    stepSource: 'document_expansion',
    steps: documents.flatMap((document) =>
      document.pages.map((page) => ({
        id: `document-expansion:${page.source}:${page.documentId}:${page.pageIndex}`,
        sortOrder: sortOrder++,
        kioskDocumentId: document.kioskDocumentId,
        assemblyProcedureDocumentId: document.assemblyProcedureDocumentId,
        pageIndex: page.pageIndex,
        viewMode: 'FULL_PAGE' as const,
        cropXRatio: null,
        cropYRatio: null,
        cropWidthRatio: null,
        cropHeightRatio: null,
        title: null,
        instructionText: null,
        emphasis: 'NORMAL' as const,
        documentType: document.documentType,
        documentTitle: document.displayTitle || document.title,
        pageUrl: page.pageUrl
      }))
    )
  };
}

export class AssemblyProcedureSequenceService {
  constructor(
    private readonly legacyOrderService = new AssemblyLegacyProcedureOrderService(),
    private readonly render = new PdfStorageRenderAdapter(),
    private readonly procedureStepService = new AssemblyTemplateProcedureStepService()
  ) {}

  async resolveForWorkSession(sessionId: string): Promise<AssemblyProcedureSequence | null> {
    const session = await prisma.assemblyWorkSession.findUnique({
      where: { id: sessionId },
      select: {
        targetUnit: true,
        template: {
          select: {
            id: true,
            procedureDocument: {
              select: {
                id: true,
                name: true,
                imageRelativePath: true
              }
            },
            procedureItems: assemblyTemplateProcedureItemsInclude
            ,
            procedureSteps: assemblyTemplateProcedureStepsInclude
          }
        }
      }
    });
    if (!session) return null;

    const fallbackProcedureDocument = session.template.procedureDocument ?? null;
    const storedItems = session.template.procedureItems.map(mapTemplateProcedureItem);
    const storedSteps = this.procedureStepService.mapStoredSteps(
      session.template.procedureSteps
    );
    const order =
      storedItems.length > 0
        ? {
            machineName: session.targetUnit.trim(),
            machineNameKey: normalizeMachineNameForCompare(session.targetUnit),
            items: storedItems
          }
        : await this.legacyOrderService.getByMachineName(session.targetUnit);
    const source: AssemblyTemplateProcedureSequenceSource =
      storedItems.length > 0
        ? 'template_version'
        : order.items.length > 0
          ? 'legacy_machine_order'
          : 'primary_fallback';
    if (source !== 'template_version') {
      logger.info(
        { sessionId, templateId: session.template.id, targetUnit: session.targetUnit, source },
        'assembly_work_session_template_procedure_sequence_fallback'
      );
    }
    if (order.items.length === 0) {
      const documents = await buildFallbackSequenceDocuments(fallbackProcedureDocument?.id);
      const procedureSteps = buildProcedureSteps(documents, storedSteps);
      return {
        mode: 'fallback',
        source,
        reason: documents.length > 0 ? 'not_configured' : 'not_configured',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents,
        ...procedureSteps,
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
      const procedureSteps = buildProcedureSteps(documents, storedSteps);
      return {
        mode: 'fallback',
        source,
        reason: 'no_enabled_documents',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents,
        ...procedureSteps,
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

    const assemblyOverlays = await prisma.assemblyProcedureOverlayElement.findMany({
      where: { documentId: { in: assemblyDocumentIds } },
      orderBy: [
        { documentId: 'asc' },
        { pageIndex: 'asc' },
        { zIndex: 'asc' },
        { createdAt: 'asc' }
      ],
      include: { asset: true }
    });
    const assemblyOverlaysByDocumentId = new Map<string, AssemblyProcedureOverlayRow[]>();
    for (const overlay of assemblyOverlays) {
      const current = assemblyOverlaysByDocumentId.get(overlay.documentId) ?? [];
      current.push(overlay);
      assemblyOverlaysByDocumentId.set(overlay.documentId, current);
    }

    const documents = (
      await Promise.all(
        enabledItems.map((item) =>
          toSequenceDocument(
            item,
            this.render,
            assemblyPagesByDocumentId,
            assemblyOverlaysByDocumentId
          )
        )
      )
    ).filter((document): document is AssemblyProcedureSequenceDocument => document != null && document.pages.length > 0);
    if (documents.length === 0) {
      const fallbackDocuments = await buildFallbackSequenceDocuments(fallbackProcedureDocument?.id);
      const procedureSteps = buildProcedureSteps(fallbackDocuments, storedSteps);
      return {
        mode: 'fallback',
        source,
        reason: 'no_page_images',
        machineName: order.machineName,
        machineNameKey: order.machineNameKey,
        documents: fallbackDocuments,
        ...procedureSteps,
        fallbackProcedureDocument
      };
    }

    const procedureSteps = buildProcedureSteps(documents, storedSteps);
    return {
      mode: 'configured',
      source,
      machineName: order.machineName,
      machineNameKey: order.machineNameKey,
      documents,
      ...procedureSteps,
      fallbackProcedureDocument
    };
  }
}
