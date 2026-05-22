import {
  planLoanInspectionCardPlacements,
  type LoanInspectionCardPlacement,
} from '../../shared/loan-inspection-card/card-layout.js';
import { MI_INSTRUMENT_DETAIL_COLUMN, type MiBodyLine } from './mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';

export type MiCardPlacement = LoanInspectionCardPlacement & {
  row: MiLoanInspectionTableRow;
  bodyLines: MiBodyLine[];
};

const MI_COLUMNS = {
  detailColumn: MI_INSTRUMENT_DETAIL_COLUMN,
  namesColumn: '計測機器名称一覧',
};

export function planMiInspectionCardPlacements(params: {
  rows: readonly MiLoanInspectionTableRow[];
  cardsTop: number;
  cardsAreaHeight: number;
  padding: number;
  cardWidth: number;
  cardGap: number;
  numColumns: number;
  scale: number;
}): { placements: MiCardPlacement[]; truncated: boolean; placedCount: number; totalRows: number } {
  return planLoanInspectionCardPlacements({ ...params, columns: MI_COLUMNS }) as {
    placements: MiCardPlacement[];
    truncated: boolean;
    placedCount: number;
    totalRows: number;
  };
}
