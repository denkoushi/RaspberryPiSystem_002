import { api } from '../http';

import type { TorqueWrenchStorageLocation } from '@raspi-system/shared-types';

export type TorqueWrenchModelApi = {
  id: string;
  manufacturer: string;
  modelNumber: string;
  torqueMinNm: string;
  torqueMaxNm: string;
  resolutionNm: string | null;
  communicationType: string;
  outputProfile: string | null;
  isActive: boolean;
};

export type TorqueWrenchSettingApi = {
  id: string;
  lowerLimit: string;
  nominalTorque: string;
  upperLimit: string;
  unit: string;
  lowerLimitNm: string;
  nominalTorqueNm: string;
  upperLimitNm: string;
  effectiveAt: string;
  reason: string | null;
};

export type TorqueWrenchProfileApi = {
  id: string;
  modelId: string;
  serialNumber: string;
  measuringInstrument: {
    id: string;
    name: string;
    managementNumber: string;
    storageLocation: string | null;
    calibrationExpiryDate: string | null;
    status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  };
  model: TorqueWrenchModelApi;
  settingHistories: TorqueWrenchSettingApi[];
};

export type TorqueWrenchCapabilityGroupApi = {
  id: string;
  name: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  isActive: boolean;
  models: Array<{ modelId: string; model: TorqueWrenchModelApi }>;
};

export async function listTorqueWrenchModels(includeInactive = false) {
  const { data } = await api.get<{ models: TorqueWrenchModelApi[] }>('/torque-wrench-models', {
    params: { includeInactive }
  });
  return data.models;
}

export async function createTorqueWrenchModel(payload: {
  manufacturer: string;
  modelNumber: string;
  torqueMinNm: number;
  torqueMaxNm: number;
  resolutionNm?: number | null;
  communicationType?: string;
  outputProfile?: string | null;
}) {
  const { data } = await api.post<{ model: TorqueWrenchModelApi }>('/torque-wrench-models', payload);
  return data.model;
}

export async function updateTorqueWrenchModel(id: string, payload: Partial<{
  manufacturer: string;
  modelNumber: string;
  torqueMinNm: number;
  torqueMaxNm: number;
  resolutionNm: number | null;
  isActive: boolean;
}>) {
  const { data } = await api.put<{ model: TorqueWrenchModelApi }>(`/torque-wrench-models/${id}`, payload);
  return data.model;
}

export async function listTorqueWrenches(includeInactive = false) {
  const { data } = await api.get<{ torqueWrenches: TorqueWrenchProfileApi[] }>('/torque-wrenches', {
    params: { includeInactive }
  });
  return data.torqueWrenches;
}

export async function createTorqueWrench(payload: {
  name: string;
  managementNumber: string;
  modelId: string;
  serialNumber: string;
  storageLocation: TorqueWrenchStorageLocation;
  calibrationExpiryDate?: string | null;
}) {
  const { data } = await api.post<{ torqueWrench: TorqueWrenchProfileApi }>('/torque-wrenches', payload);
  return data.torqueWrench;
}

export async function updateTorqueWrench(id: string, payload: Partial<{
  name: string;
  managementNumber: string;
  modelId: string;
  serialNumber: string;
  storageLocation: TorqueWrenchStorageLocation;
  calibrationExpiryDate: string | null;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
}>) {
  const { data } = await api.put<{ torqueWrench: TorqueWrenchProfileApi }>(`/torque-wrenches/${id}`, payload);
  return data.torqueWrench;
}

export async function addTorqueWrenchSetting(
  id: string,
  payload: { lowerLimit: number; nominalTorque: number; upperLimit: number; unit: string; reason?: string | null }
) {
  const { data } = await api.post<{ setting: TorqueWrenchSettingApi }>(`/torque-wrenches/${id}/settings`, payload);
  return data.setting;
}

export async function listTorqueWrenchCapabilityGroups(includeInactive = false) {
  const { data } = await api.get<{ capabilityGroups: TorqueWrenchCapabilityGroupApi[] }>(
    '/torque-wrench-capability-groups',
    { params: { includeInactive } }
  );
  return data.capabilityGroups;
}

export async function listCompatibleTorqueWrenchCapabilityGroups(params: {
  nominalDiameter: string;
  boltLengthMm?: number | null;
  material?: string | null;
  strengthClass?: string | null;
}) {
  const { data } = await api.get<{ capabilityGroups: TorqueWrenchCapabilityGroupApi[] }>(
    '/torque-wrench-capability-groups/compatible',
    { params }
  );
  return data.capabilityGroups;
}

export async function createTorqueWrenchCapabilityGroup(payload: {
  name: string;
  nominalDiameter: string;
  boltLengthMm: number;
  material: string;
  strengthClass: string;
  modelIds: string[];
}) {
  const { data } = await api.post<{ capabilityGroup: TorqueWrenchCapabilityGroupApi }>(
    '/torque-wrench-capability-groups',
    payload
  );
  return data.capabilityGroup;
}

export async function updateTorqueWrenchCapabilityGroup(id: string, payload: Partial<{
  name: string;
  nominalDiameter: string;
  boltLengthMm: number;
  material: string;
  strengthClass: string;
  modelIds: string[];
  isActive: boolean;
}>) {
  const { data } = await api.put<{ capabilityGroup: TorqueWrenchCapabilityGroupApi }>(
    `/torque-wrench-capability-groups/${id}`,
    payload
  );
  return data.capabilityGroup;
}

export async function listCompatibleTorqueWrenchesForSession(sessionId: string) {
  const { data } = await api.get<{ torqueWrenches: Array<{ profile: TorqueWrenchProfileApi; conditionFingerprint: string }> }>(
    `/assembly/work-sessions/${sessionId}/compatible-torque-wrenches`
  );
  return data.torqueWrenches;
}

export async function confirmAssemblyTorqueWrench(
  sessionId: string,
  payload: { expectedTemplateBoltId: string; torqueWrenchProfileId: string; physicalDisplayConfirmed: true }
) {
  const { data } = await api.post<{ confirmation: { id: string; torqueWrenchProfileId: string; settingHistoryId: string } }>(
    `/assembly/work-sessions/${sessionId}/torque-wrench-confirmations`,
    payload
  );
  return data.confirmation;
}

export type CurrentTorqueWrenchConfirmationApi = {
  id: string;
  confirmedAt: string;
  templateBoltId: string;
  markerNo: number;
  torqueWrenchProfileId: string;
  settingHistoryId: string;
  serialNumber: string;
  manufacturer: string;
  modelNumber: string;
  setting: {
    lowerLimit: string;
    nominalTorque: string;
    upperLimit: string;
    unit: string;
  };
};

export async function listCurrentTorqueWrenchConfirmations(sessionId: string) {
  const { data } = await api.get<{ confirmations: CurrentTorqueWrenchConfirmationApi[] }>(
    `/assembly/work-sessions/${sessionId}/torque-wrench-confirmations/current`
  );
  return data.confirmations;
}

export async function recordAssemblyTorqueOverride(
  sessionId: string,
  payload: { confirmationId: string; value: number; unit: string; reason: string }
) {
  const { data } = await api.post<{
    session: { id: string; currentBoltId: string | null };
    outcome: { kind: 'accepted_ok' | 'recorded_ng'; torqueRecordId: string; movedToBoltId: string | null };
  }>(`/assembly/work-sessions/${sessionId}/record-torque-override`, payload);
  return data;
}
