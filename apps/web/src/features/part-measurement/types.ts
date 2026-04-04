export type PartMeasurementProcessGroup = 'cutting' | 'grinding';

/** POST /part-measurement/templates の templateScope（API と同期） */
export type PartMeasurementTemplateScope = 'three_key' | 'fhincd_resource' | 'fhinmei_only';

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
  /** 図面上の番号など（任意） */
  displayMarker: string | null;
  unit: string | null;
  allowNegative: boolean;
  decimalPlaces: number;
};

/** 図面1枚。FIHNCD に紐づけない再利用単位。 */
export type PartMeasurementVisualTemplateDto = {
  id: string;
  name: string;
  /** 例: /api/storage/part-measurement-drawings/{uuid}.png */
  drawingImageRelativePath: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** GET /part-measurement/templates/candidates の matchKind（API と同期） */
export type PartMeasurementTemplateMatchKind =
  | 'exact_resource'
  | 'two_key_fhincd_resource'
  | 'one_key_fhinmei';

export type PartMeasurementTemplateDto = {
  id: string;
  fhincd: string;
  resourceCd: string;
  /** 正本（切削/研削）のみ。候補テンプレでは null */
  processGroup: PartMeasurementProcessGroup | null;
  templateScope: PartMeasurementTemplateScope;
  candidateFhinmei: string | null;
  name: string;
  version: number;
  isActive: boolean;
  visualTemplateId: string | null;
  visualTemplate: PartMeasurementVisualTemplateDto | null;
  items: PartMeasurementTemplateItemDto[];
};

export type PartMeasurementTemplateCandidateDto = {
  matchKind: PartMeasurementTemplateMatchKind;
  selectable: boolean;
  itemCount: number;
  template: PartMeasurementTemplateDto;
};

/** `/kiosk/part-measurement/template/pick` へ渡す location state */
export type KioskPartMeasurementTemplatePickLocationState = {
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  machineName: string | null;
  scheduleRowId?: string | null;
  scannedBarcodeRaw?: string | null;
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
