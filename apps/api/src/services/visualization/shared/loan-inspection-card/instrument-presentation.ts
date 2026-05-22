import {
  ACTIVE_BODY_FONT_SCALE,
  RETURNED_BODY_FONT_SCALE,
  type LoanInspectionInstrumentKind,
} from './display.types.js';

export type LoanInspectionEntryLayoutMode = 'activeTwoLine' | 'returnedOneLine';

export type LoanInspectionEntryPresentation = {
  layoutMode: LoanInspectionEntryLayoutMode;
  bodyFontScale: number;
};

const PRESENTATION_BY_KIND: Record<LoanInspectionInstrumentKind, LoanInspectionEntryPresentation> = {
  active: { layoutMode: 'activeTwoLine', bodyFontScale: ACTIVE_BODY_FONT_SCALE },
  returned: { layoutMode: 'returnedOneLine', bodyFontScale: RETURNED_BODY_FONT_SCALE },
};

export function presentationForInstrumentKind(kind: LoanInspectionInstrumentKind): LoanInspectionEntryPresentation {
  return PRESENTATION_BY_KIND[kind];
}
