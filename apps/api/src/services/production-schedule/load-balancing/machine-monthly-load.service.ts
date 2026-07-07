import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../constants.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../seiban-machine-display-names.service.js';
import {
  assembleMachineMonthlyLoadResult,
  buildMachineSummariesFromFseibanAgg,
  listFseibansForMachineName,
  resolveMachineNameForFseiban
} from './machine-monthly-load-assembler.js';
import {
  aggregateMachineMonthlyLoadByFseiban,
  listMachineMonthlyLoadQueryRows,
  toEffectiveDueDateSource,
  toYearMonthKey
} from './machine-monthly-load-query.service.js';
import type { MachineMonthlyLoadEnrichedRow, MachineMonthlyLoadResult } from './machine-monthly-load.types.js';
import { parseYearMonthRangeInclusive } from './year-month-range.js';

function enrichMachineMonthlyLoadRows(params: {
  queryRows: Awaited<ReturnType<typeof listMachineMonthlyLoadQueryRows>>;
  machineNames: Record<string, string | null | undefined>;
}): MachineMonthlyLoadEnrichedRow[] {
  return params.queryRows.map((row) => {
    const machineName = resolveMachineNameForFseiban(
      row.fseiban,
      params.machineNames,
      SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
    );
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
}

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
  const selectedMachineName = params.machineName?.trim() || null;
  const selectedFhincd = params.fhincd?.trim() || null;

  const fseibanAgg = await aggregateMachineMonthlyLoadByFseiban({
    siteKey,
    deviceScopeKey: params.deviceScopeKey,
    rangeStart: range.rangeStart,
    rangeEndExclusive: range.rangeEndExclusive
  });

  const fseibans = [...new Set(fseibanAgg.map((row) => row.fseiban).filter((value) => value.length > 0))];
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(fseibans);
  const machines = buildMachineSummariesFromFseibanAgg(
    fseibanAgg,
    machineNames,
    SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
  );

  if (!selectedMachineName) {
    return assembleMachineMonthlyLoadResult({
      siteKey,
      fromMonth: range.fromMonth,
      toMonth: range.toMonth,
      months: range.months,
      rows: [],
      machines,
      selectedMachineName: null,
      selectedFhincd
    });
  }

  const matchingFseibans = listFseibansForMachineName({
    aggregates: fseibanAgg,
    machineNames,
    machineName: selectedMachineName,
    unregisteredLabel: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL
  });

  const queryRows =
    matchingFseibans.length > 0
      ? await listMachineMonthlyLoadQueryRows({
          siteKey,
          deviceScopeKey: params.deviceScopeKey,
          rangeStart: range.rangeStart,
          rangeEndExclusive: range.rangeEndExclusive,
          fseibans: matchingFseibans
        })
      : [];

  const enriched = enrichMachineMonthlyLoadRows({ queryRows, machineNames });

  return assembleMachineMonthlyLoadResult({
    siteKey,
    fromMonth: range.fromMonth,
    toMonth: range.toMonth,
    months: range.months,
    rows: enriched,
    machines,
    selectedMachineName,
    selectedFhincd
  });
}
