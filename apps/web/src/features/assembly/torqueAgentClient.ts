export type TorqueAgentLeaseState =
  | 'available'
  | 'owned_by_self'
  | 'owned_by_other'
  | 'handoff_wait'
  | 'expired'
  | 'communication_lost'
  | 'fenced';

export type TorqueAgentLeaseStatus = {
  ok: boolean;
  ready: boolean;
  state: TorqueAgentLeaseState;
  owner: {
    clientDeviceName: string;
    clientDeviceLocation: string | null;
  } | null;
  bound: boolean;
  leaseOwned: boolean;
  bluetoothPowered: boolean;
  hidExclusive: boolean;
  lastError: string | null;
};

type TorqueAgentBindingPayload = {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string | null;
  torqueWrenchProfileId: string | null;
};

type TorqueAgentLeaseAcquirePayload = {
  sessionId: string;
  currentTemplateBoltId: string;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
};

type TorqueAgentLeaseTakeoverPayload = TorqueAgentLeaseAcquirePayload & {
  physicalWrenchPresent: true;
  reason: string;
};

const TORQUE_AGENT_ORIGIN = 'http://127.0.0.1:7073';

async function requestTorqueAgent(
  path: string,
  init?: RequestInit
): Promise<TorqueAgentLeaseStatus> {
  const response = await fetch(`${TORQUE_AGENT_ORIGIN}${path}`, init);
  if (!response.ok) throw new Error(`torque-agent ${response.status}`);
  return response.json() as Promise<TorqueAgentLeaseStatus>;
}

function postTorqueAgent(
  path: string,
  payload: object,
  keepalive = false
): Promise<TorqueAgentLeaseStatus> {
  return requestTorqueAgent(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive
  });
}

export function getTorqueAgentHealth(): Promise<TorqueAgentLeaseStatus> {
  return requestTorqueAgent('/health');
}

export function heartbeatTorqueAgent(
  payload: TorqueAgentBindingPayload
): Promise<TorqueAgentLeaseStatus> {
  return postTorqueAgent('/heartbeat', payload);
}

export function acquireTorqueAgentLease(
  payload: TorqueAgentLeaseAcquirePayload
): Promise<TorqueAgentLeaseStatus> {
  return postTorqueAgent('/lease/acquire', payload);
}

export function takeoverTorqueAgentLease(
  payload: TorqueAgentLeaseTakeoverPayload
): Promise<TorqueAgentLeaseStatus> {
  return postTorqueAgent('/lease/takeover', payload);
}

export function releaseTorqueAgentLease(
  reason: string,
  keepalive = false
): Promise<TorqueAgentLeaseStatus> {
  return postTorqueAgent('/lease/release', { reason }, keepalive);
}
