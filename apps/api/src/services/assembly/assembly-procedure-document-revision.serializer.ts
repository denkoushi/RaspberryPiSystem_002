import {
  type AssemblyProcedureImageObjectFit,
  type AssemblyProcedureOverlayElement,
  type AssemblyProcedureOverlayTextStyle
} from '@raspi-system/shared-types';

import type { AssemblyProcedureOverlayElementRow } from './assembly-procedure-overlay.persistence.js';

type AssemblyProcedureDocumentRevisionSerializationInput = {
  id: string;
  name: string;
  imageRelativePath: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  pages: Array<{
    pageIndex: number;
    imageRelativePath: string;
  }>;
  overlayElements: AssemblyProcedureOverlayElementRow[];
  revisionMetadata: {
    revisionRootId: string;
    revisionNumber: number;
    supersedesDocumentId: string | null;
    isRevisionHead: boolean;
    editVersion: number;
  } | null;
};

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export type AssemblyProcedureDocumentRevisionDto = {
  id: string;
  name: string;
  imageRelativePath: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  isActive: boolean;
  revisionRootId: string | null;
  revisionNumber: number;
  supersedesDocumentId: string | null;
  isRevisionHead: boolean;
  editVersion: number;
  createdAt: string;
  updatedAt: string;
  pages: Array<{
    pageIndex: number;
    imageRelativePath: string;
    assetId: string | null;
    overlays: AssemblyProcedureOverlayElement[];
  }>;
  assets: Record<string, {
    assetId: string;
    storageKey: string;
    contentType: string;
    byteSize: number;
    url: string;
  }>;
};

export function assemblyProcedureAssetUrl(assetId: string, storageKey: string): string {
  const storageName = storageKey.split('/').at(-1);
  return storageName
    ? `/api/storage/assembly-procedure-assets/${encodeURIComponent(storageName)}`
    : `/api/storage/assembly-procedure-assets/${encodeURIComponent(assetId)}`;
}

export function serializeAssemblyProcedureOverlayElement(
  row: AssemblyProcedureOverlayElementRow
): AssemblyProcedureOverlayElement {
  const base = {
    id: row.id,
    pageIndex: row.pageIndex,
    bbox: {
      xRatio: numberValue(row.xRatio),
      yRatio: numberValue(row.yRatio),
      widthRatio: numberValue(row.widthRatio),
      heightRatio: numberValue(row.heightRatio)
    },
    zIndex: row.zIndex,
    opacity: numberValue(row.opacity),
    mask: row.maskEnabled
      ? { enabled: true, color: row.maskColor ?? '#ffffff' }
      : undefined
  };
  if (row.kind === 'TEXT') {
    return {
      ...base,
      kind: 'TEXT',
      text: row.text ?? '',
      style: (row.textStyle ?? undefined) as AssemblyProcedureOverlayTextStyle | undefined
    };
  }
  if (row.kind === 'IMAGE') {
    return {
      ...base,
      kind: 'IMAGE',
      assetId: row.assetId ?? '',
      objectFit: (row.objectFit as AssemblyProcedureImageObjectFit | null) ?? 'contain'
    };
  }
  return {
    ...base,
    kind: 'SHAPE',
    shape: row.shapeKind ?? 'RECTANGLE',
    strokeColor: row.strokeColor ?? undefined,
    fillColor: row.fillColor ?? undefined,
    strokeWidthRatio: row.strokeWidthRatio == null ? undefined : numberValue(row.strokeWidthRatio),
    start:
      row.shapeStartXRatio == null || row.shapeStartYRatio == null
        ? undefined
        : { xRatio: numberValue(row.shapeStartXRatio), yRatio: numberValue(row.shapeStartYRatio) },
    end:
      row.shapeEndXRatio == null || row.shapeEndYRatio == null
        ? undefined
        : { xRatio: numberValue(row.shapeEndXRatio), yRatio: numberValue(row.shapeEndYRatio) }
  };
}

export function serializeAssemblyProcedureDocumentRevision(
  doc: AssemblyProcedureDocumentRevisionSerializationInput
): AssemblyProcedureDocumentRevisionDto {
  const assets: AssemblyProcedureDocumentRevisionDto['assets'] = {};
  const overlaysByPage = new Map<number, AssemblyProcedureOverlayElement[]>();
  for (const overlay of doc.overlayElements) {
    if (overlay.asset) {
      assets[overlay.asset.id] = {
        assetId: overlay.asset.id,
        storageKey: overlay.asset.storageKey,
        contentType: overlay.asset.contentType,
        byteSize: overlay.asset.byteSize,
        url: assemblyProcedureAssetUrl(overlay.asset.id, overlay.asset.storageKey)
      };
    }
    const values = overlaysByPage.get(overlay.pageIndex) ?? [];
    values.push(serializeAssemblyProcedureOverlayElement(overlay));
    overlaysByPage.set(overlay.pageIndex, values);
  }
  return {
    id: doc.id,
    name: doc.name,
    imageRelativePath: doc.imageRelativePath,
    status: doc.status === 'PUBLISHED' ? 'published' : 'draft',
    publishedAt: doc.publishedAt?.toISOString() ?? null,
    isActive: doc.isActive,
    revisionRootId: doc.revisionMetadata?.revisionRootId ?? null,
    revisionNumber: doc.revisionMetadata?.revisionNumber ?? 1,
    supersedesDocumentId: doc.revisionMetadata?.supersedesDocumentId ?? null,
    isRevisionHead: doc.revisionMetadata?.isRevisionHead ?? true,
    editVersion: doc.revisionMetadata?.editVersion ?? 0,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    assets,
    pages: doc.pages.map((page) => ({
      pageIndex: page.pageIndex,
      imageRelativePath: page.imageRelativePath,
      assetId: null,
      overlays: overlaysByPage.get(page.pageIndex) ?? []
    }))
  };
}
