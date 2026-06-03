import {
  inspectionDrawingCreateFlatBandItemClassName,
  inspectionDrawingCreateVersionBadgeClassName
} from './inspectionDrawingKioskUi';

type Props = {
  version: number;
  isActive: boolean;
};

/** 作成/改版ヘッダー — 版バッジ（dl 外・band 直下） */
export function InspectionDrawingCreateVersionBadge({ version, isActive }: Props) {
  return (
    <span
      data-testid="inspection-drawing-create-version-badge"
      className={`${inspectionDrawingCreateVersionBadgeClassName} ${inspectionDrawingCreateFlatBandItemClassName}`}
    >
      v{version} · {isActive ? '有効' : '履歴'}
    </span>
  );
}
