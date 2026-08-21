import type { Stats } from 'node:fs';

/**
 * Physical storage for an assembly-procedure asset.
 *
 * The database owns the semantic kind (source document, overlay image, and
 * future kinds).  This port deliberately stores only an immutable blob so
 * that adding a new asset kind does not require changing the filesystem
 * adapter.
 */
export interface AssemblyProcedureAssetStoragePort {
  initialize(): Promise<void>;
  save(input: AssemblyProcedureAssetSaveInput): Promise<StoredAssemblyProcedureAsset>;
  read(reference: AssemblyProcedureAssetLocation): Promise<Buffer>;
  stat(reference: AssemblyProcedureAssetLocation): Promise<Stats>;
  /** Used only to compensate a blob created by the current failed operation. */
  delete(reference: AssemblyProcedureAssetLocation): Promise<void>;
}

export type AssemblyProcedureAssetSaveInput = {
  /** A caller-provided stable ID, or a UUID is generated when omitted. */
  assetId?: string;
  data: Buffer;
  contentType: string;
  /** Optional extension from the source filename. MIME type remains canonical. */
  extension?: string;
};

export type AssemblyProcedureAssetReference = {
  assetId: string;
  storageKey: string;
  relativeUrl: string;
  contentType: string;
  size: number;
  sha256: string;
};

export type AssemblyProcedureAssetLocation = Pick<
  AssemblyProcedureAssetReference,
  'storageKey'
>;

export type StoredAssemblyProcedureAsset = AssemblyProcedureAssetReference;

export const ASSEMBLY_PROCEDURE_ASSET_NAMESPACE = 'assembly-procedure-assets';
export const ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX =
  `/api/storage/${ASSEMBLY_PROCEDURE_ASSET_NAMESPACE}/`;

export const ASSEMBLY_PROCEDURE_ASSET_MAX_BYTES = 50 * 1024 * 1024;
export const ASSEMBLY_PROCEDURE_OVERLAY_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

export const ASSEMBLY_PROCEDURE_ASSET_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
] as const;

export type AssemblyProcedureAssetContentType =
  (typeof ASSEMBLY_PROCEDURE_ASSET_CONTENT_TYPES)[number];
