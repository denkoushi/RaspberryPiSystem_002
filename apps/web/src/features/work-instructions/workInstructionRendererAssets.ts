import type { WorkInstructionOverlayAsset } from '../../api/domains/work-instructions';

export function workInstructionRendererAssets(
  assets?: Record<string, WorkInstructionOverlayAsset>
) {
  if (!assets) return undefined;
  return Object.fromEntries(
    Object.entries(assets).map(([assetId, asset]) => [assetId, {
      assetId: asset.assetId || assetId,
      storageKey: asset.storageKey ?? assetId,
      contentType: asset.contentType ?? 'image/png',
      byteSize: asset.byteSize ?? 0,
      sha256: asset.sha256,
      url: asset.url,
      relativeUrl: asset.relativeUrl
    }])
  );
}
