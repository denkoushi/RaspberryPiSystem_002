import {
  inspectionDrawingCreateMetadataSlotClassName,
  inspectionDrawingHeaderBandCenterSlotClassName,
  inspectionDrawingHeaderBandClassName,
  inspectionDrawingMetadataGridClassName,
  inspectionDrawingToolbarSlotClassName
} from './inspectionDrawingKioskUi';

import type { ReactNode } from 'react';

export type InspectionDrawingHeaderBandMetadataLayout = 'grid' | 'createCompact';

type Props = {
  metadata: ReactNode;
  toolbar: ReactNode;
  /** メタデータ列とツールバー間の余白（図面ズーム等）。縦行は増やさない */
  centerSlot?: ReactNode;
  /** 既定は本番記録向け band。作成/改版は create 用 class を渡す */
  bandClassName?: string;
  /** メタデータスロットのレイアウト（bandClassName とは独立） */
  metadataLayout?: InspectionDrawingHeaderBandMetadataLayout;
};

/** 上部: メタデータ + 中央余白（任意）+ ツールバー */
export function InspectionDrawingCreateHeaderBand({
  metadata,
  toolbar,
  centerSlot,
  bandClassName = inspectionDrawingHeaderBandClassName,
  metadataLayout = 'grid'
}: Props) {
  const metadataSlotClassName =
    metadataLayout === 'createCompact'
      ? inspectionDrawingCreateMetadataSlotClassName
      : inspectionDrawingMetadataGridClassName;

  return (
    <div className={bandClassName}>
      <div className={metadataSlotClassName}>{metadata}</div>
      {centerSlot ? (
        <div className={inspectionDrawingHeaderBandCenterSlotClassName}>{centerSlot}</div>
      ) : null}
      <div className={inspectionDrawingToolbarSlotClassName}>{toolbar}</div>
    </div>
  );
}
