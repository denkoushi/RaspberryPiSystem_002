import type { MiInstrumentEntry, MiLoanInspectionTableRow } from './mi-instrument-display.types.js';
import { MI_INSTRUMENT_DETAIL_COLUMN } from './mi-instrument-display.types.js';
import {
  parseLegacyInstrumentList,
  parseRowInstrumentEntries as parseSharedRowInstrumentEntries,
} from '../../shared/loan-inspection-card/row-instrument-entries.js';

const MI_COLUMNS = {
  detailColumn: MI_INSTRUMENT_DETAIL_COLUMN,
  namesColumn: '計測機器名称一覧',
};

export { parseLegacyInstrumentList };

export function parseRowInstrumentEntries(row: MiLoanInspectionTableRow): MiInstrumentEntry[] {
  return parseSharedRowInstrumentEntries(row, MI_COLUMNS);
}
