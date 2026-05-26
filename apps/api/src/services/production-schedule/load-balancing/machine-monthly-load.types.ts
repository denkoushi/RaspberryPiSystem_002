export type MachineMonthlyLoadMachineSummary = {
  machineName: string;
  fseibanCount: number;
  requiredMinutes: number;
};

export type MachineMonthlyLoadPartSummary = {
  fhincd: string;
  fhinmei: string;
  productNos: string[];
  fseibans: string[];
  effectiveDueDateMin: string | null;
  totalRequiredMinutes: number;
  resourceCds: string[];
};

export type MachineMonthlyLoadResourceMonthCell = {
  resourceCd: string;
  month: string;
  requiredMinutes: number;
};

export type MachineMonthlyLoadPartRowDetail = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
  effectiveDueDate: string;
  effectiveDueDateSource: 'manual' | 'csv';
};

export type MachineMonthlyLoadResult = {
  siteKey: string;
  fromMonth: string;
  toMonth: string;
  months: string[];
  machines: MachineMonthlyLoadMachineSummary[];
  selectedMachineName: string | null;
  selectedFhincd: string | null;
  parts: MachineMonthlyLoadPartSummary[];
  resourceMonths: MachineMonthlyLoadResourceMonthCell[];
  partRows: MachineMonthlyLoadPartRowDetail[];
};

export type MachineMonthlyLoadEnrichedRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fkojun: string | null;
  resourceCd: string;
  requiredMinutes: number;
  effectiveDueDate: Date;
  effectiveDueDateSource: 'manual' | 'csv';
  machineName: string;
  yearMonth: string;
};
