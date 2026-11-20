import { deriveProcedureManualKanaRow, normalizeProcedureManualCommonSubject, PROCEDURE_MANUAL_KANA_ROWS } from '@raspi-system/shared-types';

import { procedureManualButtonBase, procedureManualButtonUnselected, procedureManualKanaSelected } from './procedure-manual-button-styles';

import type { ProcedureManualCommonCatalogDto } from '../types';

export function resolveProcedureManualCommonReading(target: string, catalog: ProcedureManualCommonCatalogDto) {
  const key = normalizeProcedureManualCommonSubject(target);
  const known = catalog.subjects.find(row => row.key === key);
  const kanaRow = deriveProcedureManualKanaRow(target) ?? known?.kanaRow;
  return { key, kanaRow, needsReading: Boolean(key) && !kanaRow };
}

export function ProcedureManualKanaRowPicker({ value, onChange, disabled }: { value: string; onChange: (row: string) => void; disabled?: boolean }) {
  return <section aria-label="よみ" className="grid gap-2"><h3 className="text-base text-[#9fadb9]">よみ</h3><div className="grid grid-cols-10 gap-1.5">{PROCEDURE_MANUAL_KANA_ROWS.map(row => <button key={row} type="button" disabled={disabled} aria-pressed={value === row} className={`${procedureManualButtonBase} h-[52px] text-xl ${value === row ? procedureManualKanaSelected : procedureManualButtonUnselected}`} onClick={() => onChange(row)}>{row}</button>)}</div></section>;
}
