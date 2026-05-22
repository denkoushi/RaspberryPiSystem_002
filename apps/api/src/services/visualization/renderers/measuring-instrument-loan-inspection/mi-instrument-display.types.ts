export {
  ACTIVE_BODY_FONT_SCALE,
  RETURNED_BODY_FONT_SCALE,
  type BodyLineTone,
  type LoanInspectionBodyLine as MiBodyLine,
  type LoanInspectionInstrumentEntry as MiInstrumentEntry,
  type LoanInspectionInstrumentKind as MiInstrumentKind,
  type LoanInspectionTableRow as MiLoanInspectionTableRow,
} from '../../shared/loan-inspection-card/display.types.js';

export const MI_INSTRUMENT_DETAIL_COLUMN = '計測機器明細' as const;
export const MI_RETURNED_COUNT_COLUMN = '返却件数' as const;
