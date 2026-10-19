import {
  KIOSK_MARKER_STATUS_CLASS,
  kioskMarkerButtonClass,
  kioskMarkerInputTargetOutlineClass
} from '../../kiosk/kioskMarkerTheme';

/** 既存export互換。正本はキオスク共通マーカーテーマ。 */
export const INSPECTION_DRAWING_MARKER_STATUS_CLASS: Record<string, string> = {
  empty: KIOSK_MARKER_STATUS_CLASS.pending,
  ok: KIOSK_MARKER_STATUS_CLASS.ok,
  ng: KIOSK_MARKER_STATUS_CLASS.ng
};

/**
 * 値入力パネルが向いている測定点の外周強調（状態 ring とは outline で分離）
 */
export function inspectionDrawingMarkerInputTargetOutlineClass(isInputTarget: boolean): string {
  return kioskMarkerInputTargetOutlineClass(isInputTarget);
}

export function inspectionDrawingMarkerButtonClass(status: string): string {
  return kioskMarkerButtonClass(status === 'ok' || status === 'ng' ? status : 'pending');
}
