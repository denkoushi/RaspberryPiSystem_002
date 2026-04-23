/**
 * 計測機器エントリ種別ごとの本文レイアウト契約（レンダラーは kind 直参照を避け、ここを唯一の参照点にする）。
 */
import {
  ACTIVE_BODY_FONT_SCALE,
  RETURNED_BODY_FONT_SCALE,
  type MiInstrumentKind,
} from './mi-instrument-display.types.js';

export type MiEntryLayoutMode = 'activeTwoLine' | 'returnedOneLine';

export type MiInstrumentEntryPresentation = {
  layoutMode: MiEntryLayoutMode;
  /** namesFontSize（ベース）に掛ける本文スケール */
  bodyFontScale: number;
};

const PRESENTATION_BY_KIND: Record<MiInstrumentKind, MiInstrumentEntryPresentation> = {
  active: { layoutMode: 'activeTwoLine', bodyFontScale: ACTIVE_BODY_FONT_SCALE },
  returned: { layoutMode: 'returnedOneLine', bodyFontScale: RETURNED_BODY_FONT_SCALE },
};

export function presentationForInstrumentKind(kind: MiInstrumentKind): MiInstrumentEntryPresentation {
  return PRESENTATION_BY_KIND[kind];
}
