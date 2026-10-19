import type { AssemblyTemplateCheckItemDto, AssemblyTemplateDto } from './assemblyTemplateTypes';
import type { TorqueWrenchSettingVerificationMode } from '@raspi-system/shared-types';

export type AssemblyTorqueRecordDto = {
  id: string;
  sessionId: string;
  templateBoltId: string;
  attempt: number;
  inputSource: 'manual' | 'mock' | 'agent';
  rawPayload?: unknown;
  value: string | null;
  inputUnit?: string | null;
  valueNm?: string | null;
  judgement: 'ok' | 'ng' | 'ignored';
  accepted: boolean;
  ignoredReason: string | null;
  torqueWrenchProfileId?: string | null;
  confirmationId?: string | null;
  settingHistoryId?: string | null;
  /** Null distinguishes legacy records from the explicit BOLT mode. */
  settingVerificationMode?: TorqueWrenchSettingVerificationMode | null;
  serialNumberSnapshot?: string | null;
  manufacturerSnapshot?: string | null;
  modelNumberSnapshot?: string | null;
  settingLowerLimitSnapshot?: string | null;
  settingNominalTorqueSnapshot?: string | null;
  settingUpperLimitSnapshot?: string | null;
  settingUnitSnapshot?: string | null;
  sourceEventKey?: string | null;
  deviceRecordedAt?: string | null;
  deviceMemoryCounter?: string | null;
  deviceJudgement?: string | null;
  overrideActorUsername?: string | null;
  overrideReason?: string | null;
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
  workUnitId: string;
  lotSerialId: string | null;
  templateId: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  productNo: string;
  workId?: string;
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
    traceabilityMode?: 'LEGACY' | 'REQUIRED';
  } | null;
};

export type AssemblyWorkSessionSummaryDto = {
  id: string;
  workUnitId: string;
  lotSerialId: string | null;
  templateId: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  productNo: string;
  workId?: string;
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
  isTopLevel?: boolean;
  formalId?: string | null;
};

export type AssemblyLotSerialStatusDto = 'not_started' | 'in_progress' | 'completed' | 'cancelled';

export type AssemblyLotSerialDto = {
  id: string;
  workUnitId: string;
  lotId: string;
  sortOrder: number;
  workId?: string;
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
  operatorNameSnapshot: string | null;
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
