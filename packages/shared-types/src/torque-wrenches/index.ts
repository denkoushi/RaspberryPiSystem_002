import type { MeasuringInstrument, MeasuringInstrumentStatus } from '../measuring-instruments/index.js';

export const TORQUE_WRENCH_STORAGE_LOCATIONS = [
  'TalkPlazaF1',
  'TalkPlazaF2',
  'TalkPlazaF3',
  'MakoRoom',
  'Fab2',
  'Fab1',
  '開発棟'
] as const;

export type TorqueWrenchStorageLocation = (typeof TORQUE_WRENCH_STORAGE_LOCATIONS)[number];

export type AssemblyTorqueTraceabilityMode = 'LEGACY' | 'REQUIRED';

export const TORQUE_WRENCH_REJECTION_REASONS = [
  'UNKNOWN_SERIAL_NUMBER',
  'WRONG_PHYSICAL_WRENCH',
  'WRONG_CAPABILITY_GROUP',
  'MODEL_RANGE_NOT_COVERED',
  'INSTRUMENT_STATUS_NOT_ELIGIBLE',
  'CALIBRATION_MISSING',
  'CALIBRATION_EXPIRED',
  'SETTING_HISTORY_MISSING',
  'SETTING_MISMATCH',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_STALE',
  'STALE_TEMPLATE_BOLT',
  'UNSUPPORTED_TORQUE_UNIT',
  'DUPLICATE_WITHIN_1S',
  'DEVICE_MEMORY_REPLAY',
  'CONNECTION_LEASE_REQUIRED',
  'CONNECTION_LEASE_FENCED',
  'CONNECTION_LEASE_OWNER_MISMATCH',
  'CONNECTION_LEASE_SESSION_MISMATCH'
] as const;

export type TorqueWrenchRejectionReason = (typeof TORQUE_WRENCH_REJECTION_REASONS)[number];

export interface TorqueWrenchModelDto {
  id: string;
  manufacturer: string;
  modelNumber: string;
  torqueMinNm: string;
  torqueMaxNm: string;
  resolutionNm: string | null;
  communicationType: string;
  outputProfile: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TorqueWrenchSettingHistoryDto {
  id: string;
  torqueWrenchProfileId: string;
  lowerLimit: string;
  nominalTorque: string;
  upperLimit: string;
  unit: string;
  lowerLimitNm: string;
  nominalTorqueNm: string;
  upperLimitNm: string;
  effectiveAt: string;
  actorUserId: string | null;
  actorUsername: string | null;
  reason: string | null;
  createdAt: string;
}

export interface TorqueWrenchProfileDto {
  id: string;
  measuringInstrumentId: string;
  modelId: string;
  serialNumber: string;
  measuringInstrument: MeasuringInstrument;
  model: TorqueWrenchModelDto;
  currentSetting: TorqueWrenchSettingHistoryDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface TorqueWrenchCapabilityGroupModelDto {
  modelId: string;
  model: TorqueWrenchModelDto;
}

export interface TorqueWrenchCapabilityGroupDto {
  id: string;
  name: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  isActive: boolean;
  models: TorqueWrenchCapabilityGroupModelDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyTorqueConditionDto {
  templateBoltId: string;
  markerNo: number;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  lowerLimit: string;
  nominalTorque: string;
  upperLimit: string;
  unit: string;
}

export interface CompatibleTorqueWrenchDto {
  profile: TorqueWrenchProfileDto;
  status: MeasuringInstrumentStatus;
  calibrationExpiryDate: string;
  conditionFingerprint: string;
}

export interface AssemblyTorqueWrenchConfirmationDto {
  id: string;
  sessionId: string;
  templateBoltId: string;
  torqueWrenchProfileId: string;
  settingHistoryId: string;
  conditionFingerprint: string;
  operatorEmployeeId: string | null;
  operatorNameSnapshot: string;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
  confirmedAt: string;
}

export interface AgentTorqueEventPayload {
  sourceEventKey: string;
  expectedTemplateBoltId: string;
  confirmationId: string;
  serialNumber: string;
  value: number;
  unit: string;
  rawPayload: unknown;
  deviceRecordedAt?: string | null;
  deviceMemoryCounter?: string | null;
  deviceJudgement?: string | null;
  connectionLeaseId?: string | null;
  connectionLeaseGeneration?: number | null;
}

export type TorqueWrenchConnectionLeaseState =
  | 'available'
  | 'owned_by_self'
  | 'owned_by_other'
  | 'handoff_wait'
  | 'expired';

export interface TorqueWrenchConnectionLeaseStatusDto {
  torqueWrenchProfileId: string;
  state: TorqueWrenchConnectionLeaseState;
  owner: {
    clientDeviceName: string;
    clientDeviceLocation: string | null;
    clientDeviceId?: string;
    sessionId?: string;
  } | null;
  expiresAt: string | null;
  connectAfter: string | null;
  leaseId?: string;
  generation?: number;
}

export type AssemblyTorqueRecordOutcomeKind =
  | 'accepted_ok'
  | 'recorded_ng'
  | 'ignored_duplicate'
  | 'rejected';

export interface AssemblyTorqueRecordOutcomeDto {
  kind: AssemblyTorqueRecordOutcomeKind;
  movedToBoltId: string | null;
  areaCompleted: boolean;
  allBoltsCompleted: boolean;
  requiresAreaRestart: boolean;
  rejectionReason?: TorqueWrenchRejectionReason;
  torqueRecordId?: string;
}
