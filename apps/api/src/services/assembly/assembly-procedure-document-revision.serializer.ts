import { videosForPage, type ProcedureVideoSummary, type ProcedureVideoPageLink } from './procedure-video.service.js';
import {
  type AssemblyProcedureImageObjectFit,
  type OverlayImageTranscript,
  type AssemblyProcedureOverlayAssetMetadata,
  type AssemblyProcedureOverlayElement,
  type AssemblyProcedureOverlayTextStyle
} from '@raspi-system/shared-types';

import type { AssemblyProcedureOverlayElementRow } from './assembly-procedure-overlay.persistence.js';
import type { ProcedureManualApproval, AssemblyProcedureAsset } from '@prisma/client';

export const procedureManualApprovalInclude = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  take: 1,
  select: { employeeNameSnapshot: true, employeePositionSnapshot: true, createdAt: true }
};
export type ProcedureManualApprovalSnapshot = Pick<ProcedureManualApproval, 'employeeNameSnapshot' | 'employeePositionSnapshot' | 'createdAt'>;
export function serializeLastProcedureManualApproval(approvals?: ProcedureManualApprovalSnapshot[]) {
  const approval = approvals?.[0];
  return approval ? { employeeName: approval.employeeNameSnapshot, positionName: approval.employeePositionSnapshot, approvedAt: approval.createdAt.toISOString() } : null;
}

type ProcedureAssetSummary = Pick<AssemblyProcedureAsset, 'id' | 'storageKey' | 'contentType' | 'byteSize'>;
export type ProcedureAssetWithOriginal = ProcedureAssetSummary & {
  derivedFromAssetId?: string | null;
  derivedFromAsset?: ProcedureAssetSummary | null;
};

type AssemblyProcedureDocumentRevisionSerializationInput = {
  procedureManualApprovals?: ProcedureManualApprovalSnapshot[];
  procedureVideoLinks?: ProcedureVideoPageLink[];
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
  overlayElements: Array<AssemblyProcedureOverlayElementRow & { asset: ProcedureAssetWithOriginal | null }>;
  ownedAssets?: ProcedureAssetWithOriginal[];
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
  lastApproval: ReturnType<typeof serializeLastProcedureManualApproval>;
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
    videos: ProcedureVideoSummary[];
  }>;
  assets: Record<string, AssemblyProcedureOverlayAssetMetadata & { url: string }>;
};

export function assemblyProcedureAssetUrl(assetId: string, storageKey: string): string {
  const storageName = storageKey.split('/').at(-1);
  return storageName
    ? `/api/storage/assembly-procedure-assets/${encodeURIComponent(storageName)}`
    : `/api/storage/assembly-procedure-assets/${encodeURIComponent(assetId)}`;
}

export function serializeAssemblyProcedureAssets(doc: {
  status: 'DRAFT' | 'PUBLISHED';
  ownedAssets?: ProcedureAssetWithOriginal[];
  overlayElements?: Array<{ asset: ProcedureAssetWithOriginal | null }>;
}): AssemblyProcedureDocumentRevisionDto['assets'] {
  const assets: AssemblyProcedureDocumentRevisionDto['assets'] = {};
  const addAsset = (asset: ProcedureAssetWithOriginal) => {
    assets[asset.id] = {
      assetId: asset.id,
      storageKey: asset.storageKey,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      url: assemblyProcedureAssetUrl(asset.id, asset.storageKey),
      ...(doc.status === 'DRAFT' && asset.derivedFromAssetId
        ? { derivedFromAssetId: asset.derivedFromAssetId } : {})
    };
  };
  for (const asset of [
    ...(doc.ownedAssets ?? []),
    ...(doc.overlayElements ?? []).flatMap(({ asset }) => asset ? [asset] : [])
  ]) {
    addAsset(asset);
    if (doc.status === 'DRAFT' && asset.derivedFromAsset) addAsset(asset.derivedFromAsset);
  }
  return assets;
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
      objectFit: (row.objectFit as AssemblyProcedureImageObjectFit | null) ?? 'contain',
      transcript: row.transcript as OverlayImageTranscript | null
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
  const assets = serializeAssemblyProcedureAssets(doc);
  const overlaysByPage = new Map<number, AssemblyProcedureOverlayElement[]>();
  for (const overlay of doc.overlayElements) {
    const values = overlaysByPage.get(overlay.pageIndex) ?? [];
    values.push(serializeAssemblyProcedureOverlayElement(overlay));
    overlaysByPage.set(overlay.pageIndex, values);
  }
  return {
    lastApproval: serializeLastProcedureManualApproval(doc.procedureManualApprovals),
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
      videos: videosForPage(doc.procedureVideoLinks, page.pageIndex),
      overlays: overlaysByPage.get(page.pageIndex) ?? []
    }))
  };
}
