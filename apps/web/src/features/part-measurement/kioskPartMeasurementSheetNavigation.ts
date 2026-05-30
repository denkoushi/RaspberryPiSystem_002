import {
  getInspectionDrawingEditAccess,
  sheetUsesProductionInspectionDrawingUi
} from './inspection-drawing/productionInspectionDrawingPolicy';
import { kioskPartMeasurementInspectionEditPath } from './inspection-drawing/templateItemMappers';

import type { PartMeasurementSheetDto, PartMeasurementTemplateDto } from './types';

const tableEditPath = (sheetId: string) => `/kiosk/part-measurement/edit/${sheetId}`;

/**
 * キオスクの記録表編集先（図面UI / 表形式）を sheet メタから解決する。
 * 本番: 図面付きテンプレかつ quantity===1 のみ図面UI。評価用シートは本番一覧から来ないが URL 直打ちは図面UI可。
 */
export function resolveKioskPartMeasurementSheetEditPath(sheet: PartMeasurementSheetDto): string {
  const access = getInspectionDrawingEditAccess(sheet);
  if (access.allowed && (access.mode === 'production' || access.mode === 'evaluation')) {
    return kioskPartMeasurementInspectionEditPath(sheet.id);
  }
  return tableEditPath(sheet.id);
}

/** テンプレ選択直後など sheet 未作成時。作成後 quantity が未設定なら表形式へ寄せる。 */
export function resolveKioskPartMeasurementSheetEditPathAfterCreate(
  sheet: PartMeasurementSheetDto
): string {
  return resolveKioskPartMeasurementSheetEditPath(sheet);
}

/** 表形式 edit から図面UIへ逃がすフォールバック用 */
export function shouldRedirectTableEditToInspectionDrawing(sheet: PartMeasurementSheetDto): boolean {
  return sheetUsesProductionInspectionDrawingUi(sheet);
}

/** 候補テンプレのみ分かるとき（sheet 前）。本番図面UIは quantity=1 確定後に sheet で再判定する。 */
export function templateWouldUseProductionInspectionDrawingUiWhenQuantityOne(
  template: PartMeasurementTemplateDto
): boolean {
  if (template.visualTemplate?.drawingImageRelativePath?.trim()) {
    return template.items.length > 0 && template.items.every((it) => {
      const hasMarker =
        it.markerXRatio != null &&
        it.markerYRatio != null &&
        it.lowerLimit != null &&
        it.upperLimit != null;
      return hasMarker;
    });
  }
  return false;
}
