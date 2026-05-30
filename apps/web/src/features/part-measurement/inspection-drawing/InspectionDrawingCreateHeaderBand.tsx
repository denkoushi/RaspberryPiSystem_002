import {
  inspectionDrawingHeaderBandClassName,
  inspectionDrawingMetadataGridClassName,
  inspectionDrawingToolbarSlotClassName
} from './inspectionDrawingKioskUi';

import type { ReactNode } from 'react';

type Props = {
  metadata: ReactNode;
  toolbar: ReactNode;
};

/** 上部: メタデータ（左・半幅）+ ツールバー（右・同一行） */
export function InspectionDrawingCreateHeaderBand({ metadata, toolbar }: Props) {
  return (
    <div className={inspectionDrawingHeaderBandClassName}>
      <div className={inspectionDrawingMetadataGridClassName}>{metadata}</div>
      <div className={inspectionDrawingToolbarSlotClassName}>{toolbar}</div>
    </div>
  );
}
