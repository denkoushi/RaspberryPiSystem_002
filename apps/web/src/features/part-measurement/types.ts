export type PartMeasurementProcessGroup = 'cutting' | 'grinding';

export type PartMeasurementResolvedCandidate = {
  scheduleRowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  resourceCd: string;
  fkojun: number | null;
  machineName: string | null;
};

export type PartMeasurementTemplateItemDto = {
  id: string;
  sortOrder: number;
  datumSurface: string;
  measurementPoint: string;
  measurementLabel: string;
  unit: string | null;
  allowNegative: boolean;
};

export type PartMeasurementTemplateDto = {
  id: string;
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  name: string;
  version: number;
  isActive: boolean;
  items: PartMeasurementTemplateItemDto[];
};

export type PartMeasurementSheetDto = {
  id: string;
  status: 'DRAFT' | 'FINALIZED';
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  resourceCdSnapshot: string | null;
  processGroupSnapshot: PartMeasurementProcessGroup;
  employeeId: string | null;
  employeeNameSnapshot: string | null;
  quantity: number | null;
  scannedBarcodeRaw: string | null;
  templateId: string | null;
  clientDeviceId: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  template: PartMeasurementTemplateDto | null;
  results: Array<{ id: string; pieceIndex: number; templateItemId: string; value: string | null }>;
  employee: { id: string; displayName: string; employeeCode: string } | null;
};

export type ResolveTicketResponse = {
  processGroup: PartMeasurementProcessGroup;
  ambiguous: boolean;
  fhincdMismatch: boolean;
  candidates: PartMeasurementResolvedCandidate[];
  selected: PartMeasurementResolvedCandidate | null;
  template: PartMeasurementTemplateDto | null;
};
