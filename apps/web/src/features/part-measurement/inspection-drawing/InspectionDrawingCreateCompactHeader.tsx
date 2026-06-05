import { InspectionDrawingCreateMetaChipList } from './InspectionDrawingCreateMetaChipList';
import { InspectionDrawingCreateVersionBadge } from './InspectionDrawingCreateVersionBadge';
import {
  inspectionDrawingCreateFlatBandClassName,
  inspectionDrawingCreateFlatBandItemClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingCreateMetadataRowProps } from './InspectionDrawingCreateMetadataRow';
import type { ReactNode } from 'react';

type Props = {
  metadata: InspectionDrawingCreateMetadataRowProps;
  drawingSourceControl: ReactNode;
  centerSlot?: ReactNode;
  toolbar: ReactNode;
};

/**
 * 作成/改版専用 — フラット top-band（正本 HTML と同型）。
 * dl / badge / file / zoom / toolbar が band 直下の兄弟。
 */
export function InspectionDrawingCreateCompactHeader({
  metadata,
  drawingSourceControl,
  centerSlot,
  toolbar
}: Props) {
  const showVersionBadge = metadata.templateVersion != null && metadata.templateIsActive != null;

  return (
    <div
      data-testid="inspection-drawing-create-header-band"
      className={inspectionDrawingCreateFlatBandClassName}
    >
      <InspectionDrawingCreateMetaChipList {...metadata} />
      {showVersionBadge ? (
        <InspectionDrawingCreateVersionBadge
          version={metadata.templateVersion!}
          isActive={metadata.templateIsActive!}
        />
      ) : null}
      {drawingSourceControl}
      {centerSlot ? (
        <div
          data-testid="inspection-drawing-create-zoom-slot"
          className={inspectionDrawingCreateFlatBandItemClassName}
        >
          {centerSlot}
        </div>
      ) : null}
      <div
        data-testid="inspection-drawing-create-toolbar-slot"
        className={inspectionDrawingCreateFlatBandItemClassName}
      >
        {toolbar}
      </div>
    </div>
  );
}
