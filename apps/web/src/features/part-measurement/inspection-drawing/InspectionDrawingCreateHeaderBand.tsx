import {
  inspectionDrawingHeaderBandCenterSlotClassName,
  inspectionDrawingHeaderBandClassName,
  inspectionDrawingMetadataGridClassName,
  inspectionDrawingToolbarSlotClassName
} from './inspectionDrawingKioskUi';

import type { ReactNode } from 'react';

type Props = {
  metadata: ReactNode;
  toolbar: ReactNode;
  /** メタデータ列とツールバー間の余白（図面ズーム等）。縦行は増やさない */
  centerSlot?: ReactNode;
  /** 既定は本番記録向け band。作成/改版は create 用 class を渡す */
  bandClassName?: string;
};

/** 上部: メタデータ + 中央余白（任意）+ ツールバー */
export function InspectionDrawingCreateHeaderBand({
  metadata,
  toolbar,
  centerSlot,
  bandClassName = inspectionDrawingHeaderBandClassName
}: Props) {
  return (
    <div className={bandClassName}>
      <div className={inspectionDrawingMetadataGridClassName}>{metadata}</div>
      {centerSlot ? (
        <div className={inspectionDrawingHeaderBandCenterSlotClassName}>{centerSlot}</div>
      ) : null}
      <div className={inspectionDrawingToolbarSlotClassName}>{toolbar}</div>
    </div>
  );
}
