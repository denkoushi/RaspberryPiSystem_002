export type PartMeasurementProcessGroup = 'cutting' | 'grinding';

export type PartMeasurementSheetStatus = 'DRAFT' | 'FINALIZED' | 'CANCELLED' | 'INVALIDATED';

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
  decimalPlaces: number;
};

export type PartMeasurementTemplateDto = {
  id: string;
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  name: string;
  version: number;
  isActive: boolean;
  items: PartMeasurementTemplateItemDto[];
};

export type PartMeasurementSheetDto = {
  id: string;
  status: PartMeasurementSheetStatus;
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  resourceCdSnapshot: string | null;
  processGroupSnapshot: PartMeasurementProcessGroup;
  employeeId: string | null;
  employeeNameSnapshot: string | null;
  createdByEmployeeId: string | null;
  createdByEmployeeNameSnapshot: string | null;
  finalizedByEmployeeId: string | null;
  finalizedByEmployeeNameSnapshot: string | null;
  quantity: number | null;
  scannedBarcodeRaw: string | null;
  templateId: string | null;
  clientDeviceId: string | null;
  clientDeviceName: string | null;
  editLockClientDeviceId: string | null;
  editLockExpiresAt: string | null;
  editLockClientDeviceName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
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

export type PartMeasurementFindOrOpenHeader = {
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
};

export type FindOrOpenPartMeasurementResponse =
  | { mode: 'resume_draft'; sheet: PartMeasurementSheetDto }
  | { mode: 'created_draft'; sheet: PartMeasurementSheetDto }
  | { mode: 'view_finalized'; sheet: PartMeasurementSheetDto }
  | { mode: 'needs_resolve'; sheet: null; header: null }
  | { mode: 'needs_template'; sheet: null; header: PartMeasurementFindOrOpenHeader };
