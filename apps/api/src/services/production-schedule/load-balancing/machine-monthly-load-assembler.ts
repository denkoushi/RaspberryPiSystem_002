import type {
  MachineMonthlyLoadEnrichedRow,
  MachineMonthlyLoadMachineSummary,
  MachineMonthlyLoadPartRowDetail,
  MachineMonthlyLoadPartSummary,
  MachineMonthlyLoadResourceMonthCell,
  MachineMonthlyLoadResult
} from './machine-monthly-load.types.js';

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))].sort((a, b) => a.localeCompare(b));
}

export function aggregateMachineSummaries(rows: MachineMonthlyLoadEnrichedRow[]): MachineMonthlyLoadMachineSummary[] {
  const byMachine = new Map<string, { fseibans: Set<string>; requiredMinutes: number }>();
  for (const row of rows) {
    const key = row.machineName;
    const current = byMachine.get(key) ?? { fseibans: new Set<string>(), requiredMinutes: 0 };
    if (row.fseiban.length > 0) {
      current.fseibans.add(row.fseiban);
    }
    current.requiredMinutes += row.requiredMinutes;
    byMachine.set(key, current);
  }

  return [...byMachine.entries()]
    .map(([machineName, agg]) => ({
      machineName,
      fseibanCount: agg.fseibans.size,
      requiredMinutes: agg.requiredMinutes
    }))
    .sort((a, b) => b.requiredMinutes - a.requiredMinutes || a.machineName.localeCompare(b.machineName));
}

export function filterRowsByMachine(
  rows: MachineMonthlyLoadEnrichedRow[],
  machineName: string | null | undefined
): MachineMonthlyLoadEnrichedRow[] {
  if (!machineName || machineName.trim().length === 0) {
    return [];
  }
  const needle = machineName.trim();
  return rows.filter((row) => row.machineName === needle);
}

export function filterRowsByFhincd(
  rows: MachineMonthlyLoadEnrichedRow[],
  fhincd: string | null | undefined
): MachineMonthlyLoadEnrichedRow[] {
  if (!fhincd || fhincd.trim().length === 0) {
    return rows;
  }
  const needle = fhincd.trim().toUpperCase();
  return rows.filter((row) => row.fhincd.toUpperCase() === needle);
}

export function aggregatePartSummaries(rows: MachineMonthlyLoadEnrichedRow[]): MachineMonthlyLoadPartSummary[] {
  const byPart = new Map<
    string,
    {
      fhincd: string;
      fhinmei: string;
      productNos: Set<string>;
      fseibans: Set<string>;
      dueDates: Date[];
      requiredMinutes: number;
      resourceCds: Set<string>;
    }
  >();

  for (const row of rows) {
    if (row.fhincd.length === 0) continue;
    const key = row.fhincd.toUpperCase();
    const current = byPart.get(key) ?? {
      fhincd: row.fhincd,
      fhinmei: row.fhinmei,
      productNos: new Set<string>(),
      fseibans: new Set<string>(),
      dueDates: [],
      requiredMinutes: 0,
      resourceCds: new Set<string>()
    };
    if (row.productNo.length > 0) current.productNos.add(row.productNo);
    if (row.fseiban.length > 0) current.fseibans.add(row.fseiban);
    current.dueDates.push(row.effectiveDueDate);
    current.requiredMinutes += row.requiredMinutes;
    current.resourceCds.add(row.resourceCd);
    if (!current.fhinmei && row.fhinmei.length > 0) {
      current.fhinmei = row.fhinmei;
    }
    byPart.set(key, current);
  }

  return [...byPart.values()]
    .map((part) => {
      const minDue =
        part.dueDates.length > 0
          ? part.dueDates.reduce((min, d) => (d.getTime() < min.getTime() ? d : min), part.dueDates[0]!)
          : null;
      return {
        fhincd: part.fhincd,
        fhinmei: part.fhinmei,
        productNos: uniqueSorted([...part.productNos]),
        fseibans: uniqueSorted([...part.fseibans]),
        effectiveDueDateMin: minDue ? toIsoDate(minDue) : null,
        totalRequiredMinutes: part.requiredMinutes,
        resourceCds: uniqueSorted([...part.resourceCds])
      };
    })
    .sort(
      (a, b) =>
        b.totalRequiredMinutes - a.totalRequiredMinutes || a.fhincd.localeCompare(b.fhincd)
    );
}

export function aggregateResourceMonthCells(rows: MachineMonthlyLoadEnrichedRow[]): MachineMonthlyLoadResourceMonthCell[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.yearMonth}\u0000${row.resourceCd}`;
    totals.set(key, (totals.get(key) ?? 0) + row.requiredMinutes);
  }

  return [...totals.entries()]
    .map(([key, requiredMinutes]) => {
      const [month, resourceCd] = key.split('\u0000');
      return { resourceCd, month, requiredMinutes };
    })
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) || a.resourceCd.localeCompare(b.resourceCd)
    );
}

export function toPartRowDetails(rows: MachineMonthlyLoadEnrichedRow[]): MachineMonthlyLoadPartRowDetail[] {
  return rows
    .map((row) => ({
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fhinmei: row.fhinmei,
      fkojun: row.fkojun,
      resourceCd: row.resourceCd,
      requiredMinutes: row.requiredMinutes,
      effectiveDueDate: toIsoDate(row.effectiveDueDate),
      effectiveDueDateSource: row.effectiveDueDateSource
    }))
    .sort(
      (a, b) =>
        a.effectiveDueDate.localeCompare(b.effectiveDueDate) ||
        a.fhincd.localeCompare(b.fhincd) ||
        a.resourceCd.localeCompare(b.resourceCd)
    );
}

export function assembleMachineMonthlyLoadResult(params: {
  siteKey: string;
  fromMonth: string;
  toMonth: string;
  months: string[];
  rows: MachineMonthlyLoadEnrichedRow[];
  selectedMachineName?: string | null;
  selectedFhincd?: string | null;
}): MachineMonthlyLoadResult {
  const machines = aggregateMachineSummaries(params.rows);
  const selectedMachineName = params.selectedMachineName?.trim() || null;
  const selectedFhincd = params.selectedFhincd?.trim() || null;

  const machineScoped = filterRowsByMachine(params.rows, selectedMachineName);
  const detailScoped = filterRowsByFhincd(machineScoped, selectedFhincd);

  return {
    siteKey: params.siteKey,
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    months: params.months,
    machines,
    selectedMachineName,
    selectedFhincd,
    parts: selectedMachineName ? aggregatePartSummaries(machineScoped) : [],
    resourceMonths: selectedMachineName ? aggregateResourceMonthCells(detailScoped) : [],
    partRows: selectedMachineName ? toPartRowDetails(detailScoped) : []
  };
}
