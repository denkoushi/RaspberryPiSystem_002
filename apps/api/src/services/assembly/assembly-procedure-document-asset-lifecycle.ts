export type AssemblyProcedureAssetLeaseOwner = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  isActive: boolean;
};

export type AssemblyProcedureAssetLease = {
  id: string;
  ownerDocumentId: string | null;
  ownerDocument: AssemblyProcedureAssetLeaseOwner | null;
};

/**
 * Return each asset once when a document is being removed. Owned-but-not-yet
 * referenced uploads are included so deleting an abandoned DRAFT can reclaim
 * them; the GC still performs the final reference and age checks.
 */
export function collectAssemblyProcedureAssetIds(input: {
  sourceAssetId?: string | null;
  overlayAssetIds?: readonly (string | null | undefined)[];
  ownedAssetIds?: readonly (string | null | undefined)[];
}): string[] {
  return [...new Set([
    ...(input.sourceAssetId ? [input.sourceAssetId] : []),
    ...(input.overlayAssetIds ?? []).filter((assetId): assetId is string => Boolean(assetId)),
    ...(input.ownedAssetIds ?? []).filter((assetId): assetId is string => Boolean(assetId))
  ])];
}

/**
 * An asset leased by another active DRAFT must not be attached to this
 * document. Null leases and same-document leases are valid; inactive drafts
 * are no longer protected and can be adopted by the current save.
 */
export function findConflictingAssemblyProcedureAssetLease(
  documentId: string,
  assets: readonly AssemblyProcedureAssetLease[]
): AssemblyProcedureAssetLease | null {
  return assets.find((asset) =>
    asset.ownerDocumentId != null &&
    asset.ownerDocumentId !== documentId &&
    asset.ownerDocument?.isActive === true &&
    asset.ownerDocument.status === 'DRAFT'
  ) ?? null;
}
