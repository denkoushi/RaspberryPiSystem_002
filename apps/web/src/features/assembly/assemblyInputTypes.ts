import type { AssemblyProcedureStepEmphasisDto, AssemblyProcedureStepViewModeDto } from './assemblyProcedureSequenceTypes';

export type AssemblyTemplateBoltInput = {
  sortOrder: number;
  tighteningId?: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  boltSpec: string;
  nominalDiameter?: string | null;
  boltLengthMm?: number | null;
  material?: string | null;
  strengthClass?: string | null;
  capabilityGroupId?: string | null;
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
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
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
  traceabilityMode?: 'LEGACY' | 'REQUIRED';
  procedureItems?: Array<{
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    label?: string | null;
  }>;
  procedureSteps?: Array<{
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    pageIndex: number;
    viewMode: AssemblyProcedureStepViewModeDto;
    cropXRatio?: number | null;
    cropYRatio?: number | null;
    cropWidthRatio?: number | null;
    cropHeightRatio?: number | null;
    title?: string | null;
    instructionText?: string | null;
    emphasis?: AssemblyProcedureStepEmphasisDto;
  }>;
  accessPassword?: string;
};

export type AssemblyWorkSessionStartInput = {
  templateId: string;
  productNo: string;
  workId?: string;
  /** 旧API互換。新規呼び出しは workId を使用する。 */
  serialNo?: string;
  nameplateNo?: string | null;
  operatorNfcTagUid: string;
  requestId: string;
  targetUnit: string;
  torqueWrenchId?: string | null;
};

export type AssemblyLotCreateInput = {
  templateId: string;
  productNo: string;
  expectedQuantity: number;
  workIdMode?: 'auto' | 'manual';
  workIds?: string[];
  /** 旧API互換。新規呼び出しは workIds を使用する。 */
  serialNos?: string[];
  operatorEmployeeId?: string | null;
  operatorNameSnapshot?: string | null;
  targetUnit: string;
  torqueWrenchId?: string | null;
};

export type AssemblyOperatorAccessInput = {
  operatorNfcTagUid: string;
  requestId: string;
};

export type AssemblyWorkUnitInvalidationInput = {
  accessPassword: string;
  reason: string;
  requestId: string;
};

export type AssemblyWorkUnitInvalidationDto = {
  id: string;
  workUnitId: string;
  workId: string;
  sourceState: 'not_started' | 'in_progress' | 'completed' | 'approved';
  reason: string;
  invalidatedAt: string;
};

export type AssemblyTorqueRecordOutcome = {
  kind: 'accepted_ok' | 'recorded_ng' | 'ignored_duplicate' | 'rejected';
  movedToBoltId: string | null;
  areaCompleted: boolean;
  allBoltsCompleted: boolean;
  requiresAreaRestart: boolean;
  rejectionReason?: string;
  torqueRecordId?: string;
};
