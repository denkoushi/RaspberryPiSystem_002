import {
  inspectionDrawingHeaderBandClassName,
  inspectionDrawingHeaderBandCenterSlotClassName,
  inspectionDrawingHeaderPointListSlotClassName,
  inspectionDrawingMetadataGridClassName,
  inspectionDrawingToolbarSlotClassName
} from './inspectionDrawingKioskUi';

import type { ReactNode } from 'react';

type Props = {
  metadata: ReactNode;
  toolbar: ReactNode;
  /** メタデータ列とツールバー間の余白（図面ズーム等）。縦行は増やさない */
  centerSlot?: ReactNode;
  /** 作成/改版のみ — バンド直下の測定点一覧（main row の縦行は増やさない） */
  pointListSlot?: ReactNode;
};

/** 上部: メタデータ（左）+ 中央余白（任意）+ ツールバー（右） */
export function InspectionDrawingCreateHeaderBand({
  metadata,
  toolbar,
  centerSlot,
  pointListSlot
}: Props) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className={inspectionDrawingHeaderBandClassName}>
        <div className={inspectionDrawingMetadataGridClassName}>{metadata}</div>
        {centerSlot ? (
          <div className={inspectionDrawingHeaderBandCenterSlotClassName}>{centerSlot}</div>
        ) : null}
        <div className={inspectionDrawingToolbarSlotClassName}>{toolbar}</div>
      </div>
      {pointListSlot ? (
        <div className={inspectionDrawingHeaderPointListSlotClassName}>{pointListSlot}</div>
      ) : null}
    </div>
  );
}
