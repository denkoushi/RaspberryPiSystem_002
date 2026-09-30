import { api } from '../http';

import type {
  SelfInspectionReductionLevel,
  SelfInspectionReductionMetrics,
  SelfInspectionReductionPolicy
} from '@raspi-system/shared-types';


export type SelfInspectionReductionPeriodDays = 30 | 90 | 180;
export type SelfInspectionReductionProcessGroup = 'cutting' | 'grinding';
export type SelfInspectionChangePointKind =
  | 'TOOL_CHANGE'
  | 'SETUP_CHANGE'
  | 'MATERIAL_LOT'
  | 'MACHINE_REPAIR'
  | 'PROGRAM_CHANGE'
  | 'OTHER';

export type SelfInspectionReductionPartKey = {
  fhincd: string;
  processGroup: SelfInspectionReductionProcessGroup;
  resourceCd: string;
};

export type SelfInspectionReductionItem = {
  key: string;
  label: string;
  point: string;
  marker: string | null;
  unit: string | null;
  decimalPlaces: number;
  nominal: number | null;
  lower: number;
  upper: number;
  valueCount: number;
  mean: number | null;
  standardDeviation: number | null;
  cpk: number | null;
  drift: boolean;
  outOfToleranceCount: number;
  values: Array<{ value: number; measuredAt: string }>;
};

export type SelfInspectionReductionPart = {
  key: SelfInspectionReductionPartKey;
  fhinmei: string;
  machineName: string | null;
  templateId: string | null;
  templateVersion: number | null;
  lotCount: number;
  lotsPerMonth: number;
  recentLots: Array<{ pass: boolean; completedAt: string }>;
  metrics: SelfInspectionReductionMetrics;
  items: SelfInspectionReductionItem[];
  worstItemKey: string | null;
  judgementFailCount: number;
  changePoints: Array<{ id: string; kind: SelfInspectionChangePointKind; occurredAt: string; recordedByName: string }>;
  latestDecision: {
    id: string;
    direction: 'reduce' | 'restore';
    toLevel: SelfInspectionReductionLevel;
    decidedAt: string;
    approverName: string;
    awaitingRevision: boolean;
  } | null;
};

export type SelfInspectionReductionInsights = {
  periodDays: number;
  generatedAt: string;
  secondsPerPiece: number | null;
  parts: SelfInspectionReductionPart[];
};

export type SelfInspectionReductionApprover = {
  id: string;
  employeeId: string;
  employeeCode: string;
  displayName: string;
  createdAt: string;
};

export type SelfInspectionReductionSettings = {
  policy: SelfInspectionReductionPolicy & { updatedAt: string | null; updatedBy: string | null };
  approvers: SelfInspectionReductionApprover[];
};

export type SelfInspectionLevelDecisionResult = {
  id: string;
  direction: 'reduce' | 'restore';
  fromLabel: string;
  toLevel: SelfInspectionReductionLevel;
  toLabel: string;
  decidedAt: string;
  approverName: string;
};

const BASE = '/part-measurement/self-inspection/reduction';

export async function getSelfInspectionReductionInsights(
  periodDays: SelfInspectionReductionPeriodDays
): Promise<SelfInspectionReductionInsights> {
  const { data } = await api.get<SelfInspectionReductionInsights>(`${BASE}/insights`, { params: { periodDays } });
  return data;
}

export async function getSelfInspectionReductionSettings(): Promise<SelfInspectionReductionSettings> {
  const { data } = await api.get<SelfInspectionReductionSettings>(`${BASE}/policy`);
  return data;
}

export async function updateSelfInspectionReductionPolicy(
  payload: SelfInspectionReductionPolicy & { accessPassword: string }
): Promise<SelfInspectionReductionSettings> {
  const { data } = await api.put<SelfInspectionReductionSettings>(`${BASE}/policy`, payload);
  return data;
}

export async function addSelfInspectionReductionApprover(payload: {
  employeeTagUid: string;
  accessPassword: string;
}): Promise<SelfInspectionReductionApprover[]> {
  const { data } = await api.post<{ approvers: SelfInspectionReductionApprover[] }>(`${BASE}/approvers`, payload);
  return data.approvers;
}

export async function removeSelfInspectionReductionApprover(payload: {
  id: string;
  accessPassword: string;
}): Promise<SelfInspectionReductionApprover[]> {
  const { data } = await api.post<{ approvers: SelfInspectionReductionApprover[] }>(
    `${BASE}/approvers/${encodeURIComponent(payload.id)}/remove`,
    { accessPassword: payload.accessPassword }
  );
  return data.approvers;
}

export async function recordSelfInspectionChangePoint(
  payload: SelfInspectionReductionPartKey & { kind: SelfInspectionChangePointKind; employeeTagUid: string }
) {
  const { data } = await api.post<{ changePoint: { id: string } }>(`${BASE}/change-points`, payload);
  return data.changePoint;
}

export async function recordSelfInspectionLevelDecision(
  payload: SelfInspectionReductionPartKey & {
    direction: 'reduce' | 'restore';
    periodDays: SelfInspectionReductionPeriodDays;
    cpkThreshold: number;
    approverEmployeeTagUid: string;
  }
): Promise<SelfInspectionLevelDecisionResult> {
  const { data } = await api.post<{ decision: SelfInspectionLevelDecisionResult }>(`${BASE}/decisions`, payload);
  return data.decision;
}
