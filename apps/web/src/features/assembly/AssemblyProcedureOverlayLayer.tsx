import { OverlayLayer, overlayElementLabel } from '../overlays/OverlayLayer';

import type { AssemblyProcedureOverlayAssetDto } from './types';
import type {
  AssemblyProcedureCropRect,
  AssemblyProcedureOverlayBBox,
  AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';

type Props = {
  elements?: AssemblyProcedureOverlayElement[];
  crop?: AssemblyProcedureCropRect | null;
  selectedOverlayId?: string | null;
  interactive?: boolean;
  onSelect?: (id: string) => void;
  onNudge?: (id: string, dxRatio: number, dyRatio: number) => void;
  onUpdateBBox?: (id: string, bbox: AssemblyProcedureOverlayBBox) => void;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  className?: string;
};

/** Compatibility adapter retaining Assembly's URL and test-id namespaces. */
export function AssemblyProcedureOverlayLayer(props: Props) {
  return (
    <OverlayLayer
      {...props}
      testId="assembly-procedure-overlay-layer"
      testIdPrefix="assembly-procedure-overlay"
      resolveAssetUrl={(assetId, asset) => asset?.url ?? asset?.relativeUrl ?? `/api/storage/assembly-procedure-assets/${encodeURIComponent(assetId)}`}
    />
  );
}

export function assemblyProcedureOverlayElementLabel(element: AssemblyProcedureOverlayElement): string {
  return overlayElementLabel(element);
}

export type { Props as AssemblyProcedureOverlayLayerProps };
