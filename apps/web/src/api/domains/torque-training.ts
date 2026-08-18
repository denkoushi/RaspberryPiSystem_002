import { api } from '../http';

export type TorqueTrainingAttemptApi = {
  id: string;
  attemptNo: number | null;
  value: string | null;
  inputUnit: string | null;
  valueNm: string | null;
  nominalTorque: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  deviationNm: string | null;
  deviationPercent: string | null;
  absoluteDeviationPercent: string | null;
  judgement: 'OK' | 'UNDER' | 'OVER' | 'IGNORED';
  accepted: boolean;
  ignoredReason: string | null;
  recordedAt: string;
};

export type TorqueTrainingProgramVersionApi = {
  id: string;
  version: number;
  displayName: string;
  nominalDiameter: string;
  boltLengthMm: string;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  nominalTorque: string;
  lowerLimit: string;
  upperLimit: string;
  unit: string;
  jigConditionCode: string;
  conditionFingerprint: string;
  torqueWrenchProfiles: Array<{ id: string; serialNumber: string }>;
};

export type TorqueTrainingProgramApi = {
  id: string;
  code: string;
  isActive: boolean;
  currentVersion: number;
  versions: TorqueTrainingProgramVersionApi[];
};

export type TorqueTrainingSessionApi = {
  id: string;
  requestId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  employeeCode: string;
  employeeName: string;
  clientDeviceName: string;
  conditionFingerprint: string;
  targetAttemptCount: number;
  program: TorqueTrainingProgramVersionApi & { code: string };
  attempts: TorqueTrainingAttemptApi[];
  hasWrenchConfirmation: boolean;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  excludedAt: string | null;
  exclusionReason: string | null;
};

export type TorqueTrainingMetricApi = {
  conditionFingerprint: string;
  attemptCount: number;
  passRate: number;
  meanAbsoluteErrorPercent: number;
  variationPercent: number;
  sessions: Array<{
    sessionId: string;
    completedAt: string | null;
    attemptCount: number;
    passRate: number;
    meanAbsoluteErrorPercent: number;
    variationPercent: number;
  }>;
};

export type TorqueTrainingOperatorContextApi = {
  employee: { id: string; employeeCode: string; displayName: string };
  currentSession: TorqueTrainingSessionApi | null;
  metrics: TorqueTrainingMetricApi[];
};

export async function listTorqueTrainingPrograms() {
  const { data } = await api.get<{ programs: TorqueTrainingProgramApi[] }>('/torque-training/programs');
  return data.programs;
}

export async function resolveTorqueTrainingOperator(uid: string) {
  const { data } = await api.post<TorqueTrainingOperatorContextApi>('/torque-training/operator-context', { uid });
  return data;
}

export async function startTorqueTrainingSession(payload: { uid: string; programVersionId: string; requestId: string }) {
  const { data } = await api.post<{ session: TorqueTrainingSessionApi }>('/torque-training/sessions', payload);
  return data.session;
}

export async function getTorqueTrainingSession(sessionId: string) {
  const { data } = await api.get<{ session: TorqueTrainingSessionApi }>(`/torque-training/sessions/${sessionId}`);
  return data.session;
}

export async function cancelTorqueTrainingSession(sessionId: string, reason: string) {
  await api.post(`/torque-training/sessions/${sessionId}/cancel`, { reason });
}

export async function confirmTorqueTrainingWrench(sessionId: string, payload: { uid: string; torqueWrenchProfileId: string }) {
  const { data } = await api.post<{ confirmation: { id: string; torqueWrenchProfileId: string; serialNumber: string; settingHistoryId: string } }>(
    `/torque-training/sessions/${sessionId}/wrench-confirmations`,
    payload
  );
  return data.confirmation;
}

export type TorqueTrainingLeaseApi = {
  leaseId: string;
  generation: number;
  expiresAt: string;
  connectAfter: string;
  state?: 'available' | 'owned_by_self' | 'owned_by_other' | 'handoff_wait' | 'expired';
  owner?: {
    clientDeviceName: string;
    clientDeviceLocation: string | null;
    targetKind?: 'assembly' | 'training';
    functionLabel?: string;
  } | null;
};

export async function acquireTorqueTrainingLease(profileId: string, payload: { sessionId: string; confirmationId: string; requestId: string }) {
  const { data } = await api.post<{ lease: TorqueTrainingLeaseApi }>(
    `/torque-wrenches/${profileId}/usage-lease/acquire`,
    payload
  );
  return data.lease;
}

export async function takeoverTorqueTrainingLease(profileId: string, payload: {
  sessionId: string;
  confirmationId: string;
  requestId: string;
  physicalWrenchPresent: true;
  reason: string;
}) {
  const { data } = await api.post<{ lease: TorqueTrainingLeaseApi }>(
    `/torque-wrenches/${profileId}/usage-lease/takeover`,
    payload
  );
  return data.lease;
}

export async function releaseTorqueTrainingLease(profileId: string, payload: { sessionId: string; leaseId: string; generation: number; reason?: string | null }) {
  const { data } = await api.post<{ lease: TorqueTrainingLeaseApi }>(
    `/torque-wrenches/${profileId}/usage-lease/release`,
    payload
  );
  return data.lease;
}

export type TorqueTrainingAdminResultApi = {
  id: string;
  employeeCode: string;
  employeeName: string;
  programCode: string;
  programVersion: number;
  conditionFingerprint: string;
  status: string;
  excludedAt: string | null;
  exclusionReason: string | null;
  completedAt: string | null;
  metrics: { attemptCount: number; passRate: number; meanAbsoluteErrorPercent: number; variationPercent: number };
};

export async function listTorqueTrainingAdminPrograms() {
  const { data } = await api.get<{ programs: TorqueTrainingProgramApi[] }>('/admin/torque-training/programs');
  return data.programs;
}

export async function listTorqueTrainingAdminResults() {
  const { data } = await api.get<{ results: TorqueTrainingAdminResultApi[] }>('/admin/torque-training/results');
  return data.results;
}

export type TorqueTrainingProgramWritePayload = {
  code: string;
  displayName: string;
  nominalDiameter: string;
  boltLengthMm: number;
  material: string;
  strengthClass: string;
  capabilityGroupId: string;
  nominalTorque: number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  jigConditionCode: string;
  torqueWrenchProfileIds: string[];
};

export async function createTorqueTrainingProgram(payload: TorqueTrainingProgramWritePayload) {
  const { data } = await api.post<{ program: TorqueTrainingProgramApi }>('/admin/torque-training/programs', payload);
  return data.program;
}

export async function reviseTorqueTrainingProgram(programId: string, payload: Omit<TorqueTrainingProgramWritePayload, 'code'>) {
  const { data } = await api.post<{ version: TorqueTrainingProgramVersionApi }>(`/admin/torque-training/programs/${programId}/revisions`, payload);
  return data.version;
}

export async function deactivateTorqueTrainingProgram(programId: string, reason: string) {
  await api.post(`/admin/torque-training/programs/${programId}/deactivate`, { reason });
}

export async function excludeTorqueTrainingResult(sessionId: string, reason: string) {
  await api.post(`/admin/torque-training/sessions/${sessionId}/exclude`, { reason });
}
