export type AssemblyProcedureDocumentStatusDto = 'draft' | 'published';

export type AssemblyProcedureDocumentPageDto = {
  pageIndex: number;
  imageRelativePath: string;
};

export type AssemblyProcedureDocumentDto = {
  id: string;
  name: string;
  imageRelativePath: string;
  status: AssemblyProcedureDocumentStatusDto;
  publishedAt: string | null;
  isActive: boolean;
  pages: AssemblyProcedureDocumentPageDto[];
  createdAt: string;
  updatedAt: string;
};

export type AssemblyProcedureDocumentSummaryDto = AssemblyProcedureDocumentDto & {
  activeTemplateCount: number;
  totalTemplateCount: number;
};

export type AssemblyTemplateBoltDto = {
  id: string;
  areaId: string;
  sortOrder: number;
  tighteningId: string;
  markerNo: number;
  xRatio: string;
  yRatio: string;
  boltSpec: string;
  nominalTorque: string;
  lowerLimit: string;
  upperLimit: string;
  unit: string;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number;
  createdAt: string;
  updatedAt: string;
};

export type AssemblyTemplateCheckItemDto = {
  id: string;
  markerNo: number;
  label: string | null;
  required: boolean;
  xRatio: number;
  yRatio: number;
  sortOrder: number;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
};

export type AssemblyTemplateAreaDto = {
  id: string;
  templateId: string;
  sortOrder: number;
  processNo: string;
  areaCode: string;
  areaName: string;
  unitCode: string;
  requireManualAdvance: boolean;
  createdAt: string;
  updatedAt: string;
  bolts: AssemblyTemplateBoltDto[];
};

export type AssemblyTemplateDto = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  procedureDocumentId: string;
  createdAt: string;
  updatedAt: string;
  procedureDocument: AssemblyProcedureDocumentDto;
  areas: AssemblyTemplateAreaDto[];
  checkItems: AssemblyTemplateCheckItemDto[];
};

export type AssemblyTemplateSummaryDto = {
  id: string;
  modelCode: string;
  procedurePattern: string;
  name: string;
  version: number;
  isActive: boolean;
  procedureDocumentId: string;
  procedureDocumentName: string;
  areaCount: number;
  boltCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AssemblyTorqueRecordDto = {
  id: string;
  sessionId: string;
  templateBoltId: string;
  attempt: number;
  inputSource: 'manual' | 'mock' | 'agent';
  rawPayload?: unknown;
  value: string | null;
  judgement: 'ok' | 'ng' | 'ignored';
  accepted: boolean;
  ignoredReason: string | null;
  recordedAt: string;
  createdAt: string;
  tighteningId: string;
  markerNo: number;
  areaId: string;
  areaName: string;
};

export type AssemblyCheckRecordDto = {
  checkItemId: string;
  checked: boolean;
  checkedByOperatorName: string | null;
  checkedAt: string | null;
};

export type AssemblyCheckSummaryDto = {
  requiredTotal: number;
  requiredCompleted: number;
  allRequiredCompleted: boolean;
};

export type AssemblyWorkSessionCheckItemDto = AssemblyTemplateCheckItemDto & {
  record: AssemblyCheckRecordDto | null;
};

export type AssemblyAreaRestartLogDto = {
  id: string;
  sessionId: string;
  areaId: string;
  reason: string;
  createdAt: string;
};

export type AssemblyWorkSessionApprovalDto = {
  approvedAt: string;
  approverEmployeeId: string | null;
  approverEmployeeCodeSnapshot: string;
  approverEmployeeNameSnapshot: string;
  approverNfcTagUidSnapshot: string;
  comment: string | null;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

export type AssemblyAreaTorqueSummaryDto = {
  areaId: string;
  areaCode: string;
  areaName: string;
  processNo: string;
  totalBoltCount: number;
  acceptedOkCount: number;
  ngCount: number;
  ignoredCount: number;
};

export type AssemblyWorkSessionDto = {
  id: string;
  lotSerialId: string | null;
  templateId: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  productNo: string;
  serialNo: string;
  nameplateNo: string;
  operatorEmployeeId: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
  currentAreaId: string | null;
  currentBoltId: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  template: AssemblyTemplateDto;
  torqueRecords: AssemblyTorqueRecordDto[];
  restartLogs: AssemblyAreaRestartLogDto[];
  approval: AssemblyWorkSessionApprovalDto | null;
  areaTorqueSummaries: AssemblyAreaTorqueSummaryDto[];
  checkItems: AssemblyWorkSessionCheckItemDto[];
  checkSummary: AssemblyCheckSummaryDto;
};

export type AssemblySeibanCandidateDto = {
  fseiban: string;
  machineName: string;
  machineNameSource: 'production_schedule' | 'supplement' | 'unregistered';
  activeTemplate: {
    id: string;
    modelCode: string;
    procedurePattern: string;
    name: string;
    version: number;
  } | null;
};

export type AssemblyWorkSessionSummaryDto = {
  id: string;
  lotSerialId: string | null;
  templateId: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  productNo: string;
  serialNo: string;
  nameplateNo: string;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  templateModelCode: string;
  templateProcedurePattern: string;
  templateName: string;
  templateVersion: number;
  currentAreaId: string | null;
  currentAreaName: string | null;
  currentBoltId: string | null;
  currentBoltMarkerNo: number | null;
  acceptedBoltCount: number;
  totalBoltCount: number;
  approval: AssemblyWorkSessionApprovalDto | null;
};

export type AssemblyLotSerialStatusDto = 'not_started' | 'in_progress' | 'completed' | 'cancelled';

export type AssemblyLotSerialDto = {
  id: string;
  lotId: string;
  sortOrder: number;
  serialNo: string;
  status: AssemblyLotSerialStatusDto;
  workSessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  approval: AssemblyWorkSessionApprovalDto | null;
};

export type AssemblyLotSummaryDto = {
  id: string;
  templateId: string;
  productNo: string;
  expectedQuantity: number;
  registeredSerialCount: number;
  notStartedCount: number;
  inProgressCount: number;
  completedCount: number;
  cancelledCount: number;
  approvedCount: number;
  isWorkComplete: boolean;
  isFullyApproved: boolean;
  operatorEmployeeId: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  template: {
    id: string;
    modelCode: string;
    procedurePattern: string;
    name: string;
    version: number;
  };
  serials: AssemblyLotSerialDto[];
};

export type AssemblyProcedureOrderDocumentDto = {
  id: string;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  enabled: boolean;
  updatedAt: string;
  imageRelativePath: string | null;
};

export type AssemblyProcedureOrderItemDto = {
  id: string;
  sortOrder: number;
  label: string | null;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  document: AssemblyProcedureOrderDocumentDto;
};

export type AssemblyProcedureOrderDto = {
  id: string | null;
  machineName: string;
  machineNameKey: string;
  configured: boolean;
  items: AssemblyProcedureOrderItemDto[];
};

export type AssemblyProcedureOrderSaveInput = {
  machineName: string;
  accessPassword: string;
  items: Array<{
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    label?: string | null;
  }>;
};

export type AssemblyProcedureSequencePageDto = {
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
  pageUrl: string;
};

export type AssemblyProcedureSequenceDocumentDto = {
  orderItemId: string;
  sortOrder: number;
  label: string | null;
  documentType: 'kiosk_document' | 'assembly_procedure_document';
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  updatedAt: string;
  pageUrls: string[];
  pages: AssemblyProcedureSequencePageDto[];
};

export type AssemblyProcedureSequenceDto = {
  mode: 'configured' | 'fallback';
  reason: 'not_configured' | 'no_enabled_documents' | 'no_page_images' | null;
  machineName: string;
  machineNameKey: string;
  documents: AssemblyProcedureSequenceDocumentDto[];
  fallbackProcedureDocument: {
    id: string;
    name: string;
    imageRelativePath: string;
  } | null;
};

export type AssemblyTemplateBoltInput = {
  sortOrder: number;
  tighteningId: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  boltSpec: string;
  nominalTorque: number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

export type AssemblyTemplateCheckItemInput = {
  markerNo: number;
  label?: string | null;
  required?: boolean;
  xRatio: number;
  yRatio: number;
  sortOrder: number;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number;
};

export type AssemblyTemplateAreaInput = {
  sortOrder: number;
  processNo: string;
  areaCode: string;
  areaName: string;
  unitCode: string;
  requireManualAdvance?: boolean;
  bolts: AssemblyTemplateBoltInput[];
};

export type AssemblyTemplateCreateInput = {
  modelCode: string;
  procedurePattern: string;
  name: string;
  procedureDocumentId: string;
  areas: AssemblyTemplateAreaInput[];
  checkItems?: AssemblyTemplateCheckItemInput[];
};

export type AssemblyWorkSessionStartInput = {
  templateId: string;
  productNo: string;
  serialNo: string;
  nameplateNo?: string | null;
  operatorEmployeeId?: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
};

export type AssemblyLotCreateInput = {
  templateId: string;
  productNo: string;
  expectedQuantity: number;
  serialNos: string[];
  operatorEmployeeId?: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId: string;
};

export type AssemblyTorqueRecordOutcome = {
  kind: 'accepted_ok' | 'recorded_ng' | 'ignored_duplicate';
  movedToBoltId: string | null;
  areaCompleted: boolean;
  allBoltsCompleted: boolean;
  requiresAreaRestart: boolean;
};
