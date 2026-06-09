export type PartMeasurementProcessGroup = 'cutting' | 'grinding';

/** POST /part-measurement/templates の templateScope（API と同期） */
export type PartMeasurementTemplateScope = 'three_key' | 'fhincd_resource' | 'fhinmei_only';

export type SelfInspectionMode = 'full' | 'single' | 'first_last' | 'fixed_count';

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
  /** 図面中心UI: 0–1（任意） */
  markerXRatio: string | null;
  markerYRatio: string | null;
  nominalValue: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
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

/** キオスク検査図面一覧（要約のみ。測定点詳細は含まない） */
export type KioskInspectionDrawingTemplateSummaryDto = {
  id: string;
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup | null;
  name: string;
  version: number;
  isActive: boolean;
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  /** API 互換（fixed_count 時は fixedCount と同値） */
  selfInspectionSampleSize: number | null;
  visualTemplateId: string | null;
  visualTemplate: PartMeasurementVisualTemplateDto | null;
  itemCount: number;
};

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
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  /** API 互換（fixed_count 時は fixedCount と同値） */
  selfInspectionSampleSize: number | null;
  visualTemplateId: string | null;
  visualTemplate: PartMeasurementVisualTemplateDto | null;
  items: PartMeasurementTemplateItemDto[];
};

export type SelfInspectionStatus = 'not_started' | 'in_progress' | 'completed';

export type SelfInspectionSessionSummaryDto = {
  id: string;
  sessionBusinessKey: string;
  templateId: string;
  templateName: string;
  productNo: string;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string | null;
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
  /** 完了・入力範囲の実効必要件数（旧形式修復後は expected と一致） */
  requiredEntryCount: number;
  /** 旧形式で操作不能なときの案内（再作成導線） */
  entryCountBlockedReason?: string | null;
  completedEntryCount: number;
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: number | null;
  /** API 互換（fixed_count 時は fixedCount と同値） */
  selfInspectionSampleSize: number | null;
  status: SelfInspectionStatus;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type SelfInspectionMeasurementValueDto = {
  id: string;
  templateItemId: string;
  value: string | null;
};

export type SelfInspectionLotEntryDto = {
  id: string;
  entryIndex: number;
  entrySlotKind: 'single' | 'first' | 'last' | 'fixed';
  entrySlotLabel: string;
  createdByEmployeeId: string | null;
  createdByEmployeeNameSnapshot: string | null;
  measuringInstrumentId: string | null;
  measuringInstrumentManagementNumberSnapshot: string | null;
  measuringInstrumentNameSnapshot: string | null;
  measuringInstrumentTagUidSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  values: SelfInspectionMeasurementValueDto[];
};

export type SelfInspectionSessionDetailDto = SelfInspectionSessionSummaryDto & {
  template: PartMeasurementTemplateDto;
  /** 測定値は含まない（大量件数対策）。値は focusedEntry を参照 */
  entries: SelfInspectionLotEntryDto[];
  /** `entryIndex` クエリ指定時のみ、当該入力件の測定値 */
  focusedEntry?: SelfInspectionLotEntryDto | null;
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
  /** 既存セッションへ子シート追加するとき */
  sessionId?: string | null;
  /** 既に使っているテンプレID（再選択不可） */
  usedTemplateIds?: string[];
};

/** GET /part-measurement/sheets/:id の session ブロック */
export type PartMeasurementSessionSummaryDto = {
  id: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  completedAt: string | null;
  sheets: Array<{
    id: string;
    status: PartMeasurementSheetStatus;
    templateId: string | null;
    templateName: string | null;
    updatedAt: string;
  }>;
};

export type PartMeasurementSheetDto = {
  id: string;
  sessionId: string;
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

/** POST/PATCH/GET 記録表系で共通の `{ sheet, session }` 戻り */
export type PartMeasurementSheetWithSession = {
  sheet: PartMeasurementSheetDto;
  session: PartMeasurementSessionSummaryDto | null;
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
  | { mode: 'resume_draft'; sheet: PartMeasurementSheetDto; session: PartMeasurementSessionSummaryDto | null }
  | { mode: 'created_draft'; sheet: PartMeasurementSheetDto; session: PartMeasurementSessionSummaryDto | null }
  | { mode: 'view_finalized'; sheet: PartMeasurementSheetDto; session: PartMeasurementSessionSummaryDto | null }
  | { mode: 'needs_resolve'; sheet: null; session: null; header: null }
  | { mode: 'needs_template'; sheet: null; session: null; header: PartMeasurementFindOrOpenHeader };
