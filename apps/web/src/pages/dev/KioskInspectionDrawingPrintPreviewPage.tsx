import { formatResourceCdWithJapaneseNames } from '../../features/kiosk/leaderOrderBoard/formatResourceCdWithJapaneseNames';
import {
  INSPECTION_DRAWING_PREVIEW_IMAGE_URL,
  INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE,
  INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP
} from '../../features/part-measurement/inspection-drawing/inspectionDrawingPreviewFixtures';
import { InspectionDrawingPrintPreview } from '../../features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview';
import { buildInspectionDrawingPrintViewModel } from '../../features/part-measurement/inspection-drawing/inspectionDrawingPrintViewModel';

/** 開発専用 — 検査図面の紙出力HTMLプレビュー */
export function KioskInspectionDrawingPrintPreviewPage() {
  const issuedAt = new Date('2026-06-14T08:51:00.000Z');
  const viewModel = buildInspectionDrawingPrintViewModel({
    template: INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE,
    resourceName: formatResourceCdWithJapaneseNames(
      INSPECTION_DRAWING_PREVIEW_PRINT_TEMPLATE.resourceCd,
      INSPECTION_DRAWING_PREVIEW_RESOURCE_NAME_MAP
    ),
    issuedAt
  });

  return (
    <InspectionDrawingPrintPreview
      viewModel={viewModel}
      imageUrl={INSPECTION_DRAWING_PREVIEW_IMAGE_URL}
      showToolbar
    />
  );
}
