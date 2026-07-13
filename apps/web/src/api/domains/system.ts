import { api } from '../http';

export interface SystemInfo {
  cpuTemp: number | null;
  cpuLoad: number;
  timestamp: string;
}

export async function getSystemInfo() {
  const { data } = await api.get<SystemInfo>('/system/system-info');
  return data;
}

export interface NetworkModeStatus {
  detectedMode: 'local' | 'maintenance';
  configuredMode: 'local' | 'maintenance';
  status: 'internet_connected' | 'local_network_only';
  checkedAt: string;
  latencyMs?: number;
  source?: string;
}

export async function getNetworkModeStatus() {
  const { data } = await api.get<NetworkModeStatus>('/system/network-mode');
  return data;
}

export interface DeployStatus {
  isMaintenance: boolean;
  runId?: string;
  phase?: 'preparing' | 'deploying' | 'failed';
  startedAt?: string;
  preNotice?: {
    scheduledAt?: string;
  };
}

export type DeployAcknowledgementPhase = 'notice' | 'maintenance';

export interface DeployAcknowledgement {
  acknowledged: true;
  runId: string;
  phase: DeployAcknowledgementPhase;
  scheduledAt?: string;
}

export async function getDeployStatus(): Promise<DeployStatus> {
  const { data } = await api.get<DeployStatus>('/system/deploy-status');
  return data;
}

export async function acknowledgeDeployStatus(
  runId: string,
  phase: DeployAcknowledgementPhase = 'maintenance'
): Promise<DeployAcknowledgement> {
  const { data } = await api.post<DeployAcknowledgement>('/system/deploy-status/ack', { runId, phase });
  return data;
}
