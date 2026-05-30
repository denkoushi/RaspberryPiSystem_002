import {
  inspectionDrawingHeaderBandClassName,
  inspectionDrawingHeaderBandCenterSlotClassName,
  inspectionDrawingMetadataGridClassName,
  inspectionDrawingToolbarSlotClassName
} from './inspectionDrawingKioskUi';

import type { ReactNode } from 'react';

type Props = {
  metadata: ReactNode;
  toolbar: ReactNode;
  /** メタデータ列とツールバー間の余白（図面ズーム等）。縦行は増やさない */
  centerSlot?: ReactNode;
};

/** 上部: メタデータ（左）+ 中央余白（任意）+ ツールバー（右） */
export function InspectionDrawingCreateHeaderBand({ metadata, toolbar, centerSlot }: Props) {
  return (
    <div className={inspectionDrawingHeaderBandClassName}>
      <div className={inspectionDrawingMetadataGridClassName}>{metadata}</div>
      {centerSlot ? (
        <div className={inspectionDrawingHeaderBandCenterSlotClassName}>{centerSlot}</div>
      ) : null}
      <div className={inspectionDrawingToolbarSlotClassName}>{toolbar}</div>
    </div>
  );
}
