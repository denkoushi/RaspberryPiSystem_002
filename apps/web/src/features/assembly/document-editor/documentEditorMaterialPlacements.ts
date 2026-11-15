import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type PendingMaterialPlacement = {
  elementId: string;
  materialId: string;
  assetId?: string;
  fallbackAssetId?: string;
};

export function matchesMaterialPlacement(element: AssemblyProcedureOverlayElement, placement: PendingMaterialPlacement) {
  return element.id === placement.elementId && (placement.assetId === undefined || (element.kind === 'IMAGE' && element.assetId === placement.assetId));
}

// Remove unplaced references from a draft or recovery record.
export function removeMaterialPlacements(elements: AssemblyProcedureOverlayElement[], placements: PendingMaterialPlacement[]) {
  return elements.flatMap(element => {
    const placement = placements.find(item => matchesMaterialPlacement(element, item));
    if (!placement) return [element];
    return placement.fallbackAssetId !== undefined && element.kind === 'IMAGE'
      ? [{ ...element, assetId: placement.fallbackAssetId }]
      : [];
  });
}
