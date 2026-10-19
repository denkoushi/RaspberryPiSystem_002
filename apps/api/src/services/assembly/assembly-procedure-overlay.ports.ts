/**
 * A durable reference returned by the asset adapter. The adapter owns bytes,
 * deduplication, and physical storage; the document domain only stores this
 * immutable identity and metadata.
 */
export type AssemblyProcedureAssetReference = {
  id: string;
  kind: 'SOURCE' | 'OVERLAY_IMAGE';
  storageKey: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  originalFileName?: string | null;
  width?: number | null;
  height?: number | null;
};

export type AssemblyProcedureAssetWriteInput = {
  kind: 'SOURCE' | 'OVERLAY_IMAGE';
  bytes: Uint8Array;
  contentType: string;
  originalFileName?: string | null;
  width?: number | null;
  height?: number | null;
};

/** Physical asset persistence boundary. No filesystem or object-store call
 * belongs in the revision/overlay domain service. */
export interface AssemblyProcedureAssetPort {
  putImmutable(input: AssemblyProcedureAssetWriteInput): Promise<AssemblyProcedureAssetReference>;
  getReference(assetId: string): Promise<AssemblyProcedureAssetReference | null>;
}

export type AssemblyProcedureSourcePageInput = {
  sourceDocumentId: string;
  pageIndex: number;
  assetId?: string | null;
  imageRelativePath?: string | null;
};

/**
 * Original-document import/conversion boundary. A later adapter can render
 * pages and register source assets without changing revision persistence.
 */
export interface AssemblyProcedureOriginalSourcePort {
  listPages(sourceDocumentId: string): Promise<AssemblyProcedureSourcePageInput[]>;
}

export type AssemblyProcedureRoiRequest = {
  sourceDocumentId: string;
  pageIndex: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AssemblyProcedureRoiResult = {
  assetId: string;
  width: number;
  height: number;
};

/** ROI (region-of-interest) extraction boundary. This feature intentionally
 * does not invoke image processing in the document version service. */
export interface AssemblyProcedureRoiPort {
  extract(request: AssemblyProcedureRoiRequest): Promise<AssemblyProcedureRoiResult>;
}
