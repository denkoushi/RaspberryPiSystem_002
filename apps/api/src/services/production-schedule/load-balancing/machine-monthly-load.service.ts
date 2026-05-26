import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../seiban-machine-display-names.service.js';
import { assembleMachineMonthlyLoadResult } from './machine-monthly-load-assembler.js';
import {
  listMachineMonthlyLoadQueryRows,
  toEffectiveDueDateSource,
  toYearMonthKey
} from './machine-monthly-load-query.service.js';
import type { MachineMonthlyLoadEnrichedRow, MachineMonthlyLoadResult } from './machine-monthly-load.types.js';
import { parseYearMonthRangeInclusive } from './year-month-range.js';

export async function getProductionScheduleMachineMonthlyLoad(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  machineName?: string | null;
  fhincd?: string | null;
}): Promise<MachineMonthlyLoadResult> {
  const siteKey = resolveSiteKeyFromScopeKey(params.siteKeyInput.trim());
  const range = parseYearMonthRangeInclusive({
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    maxMonths: 12
  });

  const queryRows = await listMachineMonthlyLoadQueryRows({
    siteKey,
    deviceScopeKey: params.deviceScopeKey,
    rangeStart: range.rangeStart,
    rangeEndExclusive: range.rangeEndExclusive
  });

  const fseibans = [...new Set(queryRows.map((row) => row.fseiban).filter((v) => v.length > 0))];
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(fseibans);

  const enriched: MachineMonthlyLoadEnrichedRow[] = queryRows.map((row) => {
    const machineName =
      row.fseiban.length > 0 ? (machineNames[row.fseiban] ?? '機種名未登録') : '機種名未登録';
    return {
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fhinmei: row.fhinmei,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd,
      requiredMinutes: row.requiredMinutes,
      effectiveDueDate: row.effectiveDueDate,
      effectiveDueDateSource: toEffectiveDueDateSource(row),
      machineName,
      yearMonth: toYearMonthKey(row)
    };
  });

  return assembleMachineMonthlyLoadResult({
    siteKey,
    fromMonth: range.fromMonth,
    toMonth: range.toMonth,
    months: range.months,
    rows: enriched,
    selectedMachineName: params.machineName,
    selectedFhincd: params.fhincd
  });
}
