/**
 * The browser-facing boundary for the local torque-agent.
 *
 * Keeping this module free of React makes the transport straightforward to
 * replace in page tests and keeps localhost details out of the connection
 * state machine and its presentation components.
 */

export type TorqueWrenchConnectionTargetKind = 'assembly' | 'training';

export type TorqueWrenchConnectionOwner = {
  clientDeviceName: string;
  clientDeviceLocation: string | null;
  ownerKind?: 'ASSEMBLY' | 'TRAINING' | TorqueWrenchConnectionTargetKind;
  clientDeviceId?: string;
  sessionId?: string;
  targetKind?: TorqueWrenchConnectionTargetKind;
  /** Newer agents may provide a human-readable function name. */
  functionLabel?: string;
  /** Keep the wire contract tolerant of the API's older `function` spelling. */
  function?: string;
};

export type TorqueWrenchLocalLeaseToken = {
  leaseId: string;
  generation: number;
  profileId: string;
  sessionId: string;
  confirmationId: string;
  targetKind: TorqueWrenchConnectionTargetKind;
};

export type TorqueAgentWireLeaseState =
  | 'available'
  | 'acquiring'
  | 'owned_by_self'
  | 'handoff_wait'
  | 'ready'
  | 'owned_by_other'
  | 'communication_lost'
  | 'recovering'
  | 'fenced'
  | 'expired';

export type TorqueAgentLeaseStatus = {
  ok: boolean;
  ready: boolean;
  state: TorqueAgentWireLeaseState;
  owner: TorqueWrenchConnectionOwner | null;
  bound: boolean;
  leaseOwned: boolean;
  bluetoothPowered: boolean;
  hidExclusive: boolean;
  lastError: string | null;
  wrenchSerialNumbers?: string[];
  expiresAt?: string | null;
  connectAfter?: string | null;
  /** Owner-only fields returned by lease-capable agent versions. */
  leaseId?: string | null;
  generation?: number | null;
  targetKind?: TorqueWrenchConnectionTargetKind;
  leaseToken?: { leaseId: string; generation: number } | null;
  /** A few agent builds used `token` before the field was named explicitly. */
  token?: { leaseId: string; generation: number } | null;
  /** Current agent contract: only the local owner receives its full token. */
  selfOwnedToken?: {
    targetKind: TorqueWrenchConnectionTargetKind;
    sessionId: string;
    torqueWrenchProfileId: string;
    leaseId: string;
    generation: number;
  } | null;
};

export type TorqueWrenchConnectionBinding = {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string;
  torqueWrenchProfileId: string;
  targetKind: TorqueWrenchConnectionTargetKind;
};

export type TorqueWrenchConnectionAcquireRequest = TorqueWrenchConnectionBinding & {
  requestId: string;
};

export type TorqueWrenchConnectionTakeoverRequest = TorqueWrenchConnectionAcquireRequest & {
  physicalWrenchPresent: true;
  reason: string;
};

export type TorqueWrenchConnectionReleaseRequest = {
  reason: string;
  token: TorqueWrenchLocalLeaseToken;
  keepalive?: boolean;
};

export interface TorqueWrenchConnectionTransport {
  health(signal?: AbortSignal): Promise<TorqueAgentLeaseStatus>;
  heartbeat(binding: TorqueWrenchConnectionBinding, signal?: AbortSignal): Promise<TorqueAgentLeaseStatus>;
  acquire(request: TorqueWrenchConnectionAcquireRequest): Promise<TorqueAgentLeaseStatus>;
  takeover(request: TorqueWrenchConnectionTakeoverRequest): Promise<TorqueAgentLeaseStatus>;
  release(request: TorqueWrenchConnectionReleaseRequest): Promise<TorqueAgentLeaseStatus>;
}

export const TORQUE_AGENT_ORIGIN = 'http://127.0.0.1:7073';
export const TORQUE_AGENT_STREAM_URL = `${TORQUE_AGENT_ORIGIN.replace(/^http/, 'ws')}/stream`;
export const TORQUE_CONNECTION_HEARTBEAT_INTERVAL_MS = 2_000;

type TorqueAgentBindingPayload = {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string | null;
  torqueWrenchProfileId: string | null;
  targetKind: TorqueWrenchConnectionTargetKind;
};

type TorqueAgentAcquirePayload = {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
  targetKind: TorqueWrenchConnectionTargetKind;
};

type TorqueAgentTakeoverPayload = TorqueAgentAcquirePayload & {
  physicalWrenchPresent: true;
  reason: string;
};

type TorqueAgentReleasePayload = {
  reason: string;
  sessionId: string;
  torqueWrenchProfileId: string;
  targetKind: TorqueWrenchConnectionTargetKind;
  leaseId: string;
  generation: number;
};

export function createTorqueWrenchLocalLeaseToken(
  status: TorqueAgentLeaseStatus,
  binding: TorqueWrenchConnectionBinding
): TorqueWrenchLocalLeaseToken | null {
  const selfOwnedToken = status.selfOwnedToken;
  const leaseId = selfOwnedToken?.leaseId ?? status.leaseToken?.leaseId ?? status.token?.leaseId ?? status.leaseId;
  const rawGeneration = selfOwnedToken?.generation ?? status.leaseToken?.generation ?? status.token?.generation ?? status.generation;
  if (!leaseId || typeof rawGeneration !== 'number' || !Number.isInteger(rawGeneration) || rawGeneration <= 0) return null;
  const generation = rawGeneration as number;
  return {
    leaseId,
    generation,
    profileId: selfOwnedToken?.torqueWrenchProfileId ?? binding.torqueWrenchProfileId,
    sessionId: selfOwnedToken?.sessionId ?? binding.sessionId,
    confirmationId: binding.confirmationId,
    targetKind: selfOwnedToken?.targetKind ?? binding.targetKind
  };
}

export function sameTorqueWrenchLocalLeaseToken(
  left: TorqueWrenchLocalLeaseToken | null | undefined,
  right: TorqueWrenchLocalLeaseToken | null | undefined
): boolean {
  return Boolean(
    left
    && right
    && left.leaseId === right.leaseId
    && left.generation === right.generation
    && left.profileId === right.profileId
    && left.sessionId === right.sessionId
    && left.confirmationId === right.confirmationId
    && left.targetKind === right.targetKind
  );
}

async function requestTorqueAgent(path: string, init?: RequestInit): Promise<TorqueAgentLeaseStatus> {
  const response = await fetch(`${TORQUE_AGENT_ORIGIN}${path}`, init);
  if (!response.ok) {
    const error = new Error(`torque-agent ${response.status}`) as Error & {
      status?: number;
      payload?: unknown;
    };
    error.status = response.status;
    try {
      error.payload = await response.json();
    } catch {
      // Keep the stable error message when the agent did not return JSON.
    }
    throw error;
  }
  const body = await response.json() as TorqueAgentLeaseStatus | {
    status?: TorqueAgentLeaseStatus;
    result?: unknown;
  };
  // Newer agents wrap release in `{ result, status }`; accepting the bare
  // status keeps the transport compatible with the original localhost API.
  if ('status' in body && body.status && typeof body.status === 'object') return body.status;
  return body as TorqueAgentLeaseStatus;
}

function postTorqueAgent(
  path: string,
  payload: object,
  keepalive = false,
  signal?: AbortSignal
): Promise<TorqueAgentLeaseStatus> {
  return requestTorqueAgent(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive,
    signal
  });
}

export const localhostTorqueWrenchTransport: TorqueWrenchConnectionTransport = {
  health: (signal) => requestTorqueAgent('/health', signal ? { signal } : undefined),
  heartbeat: (binding, signal) => postTorqueAgent('/heartbeat', {
    sessionId: binding.sessionId,
    currentTemplateBoltId: binding.currentTemplateBoltId,
    confirmationId: binding.confirmationId,
    torqueWrenchProfileId: binding.torqueWrenchProfileId,
    targetKind: binding.targetKind
  } satisfies TorqueAgentBindingPayload, false, signal),
  acquire: (request) => postTorqueAgent('/lease/acquire', {
    sessionId: request.sessionId,
    currentTemplateBoltId: request.currentTemplateBoltId,
    confirmationId: request.confirmationId,
    torqueWrenchProfileId: request.torqueWrenchProfileId,
    requestId: request.requestId,
    targetKind: request.targetKind
  } satisfies TorqueAgentAcquirePayload),
  takeover: (request) => postTorqueAgent('/lease/takeover', {
    sessionId: request.sessionId,
    currentTemplateBoltId: request.currentTemplateBoltId,
    confirmationId: request.confirmationId,
    torqueWrenchProfileId: request.torqueWrenchProfileId,
    requestId: request.requestId,
    targetKind: request.targetKind,
    physicalWrenchPresent: request.physicalWrenchPresent,
    reason: request.reason
  } satisfies TorqueAgentTakeoverPayload),
  release: (request) => {
    const token = request.token;
    const payload: TorqueAgentReleasePayload = {
      reason: request.reason,
      sessionId: token.sessionId,
      torqueWrenchProfileId: token.profileId,
      targetKind: token.targetKind,
      leaseId: token.leaseId,
      generation: token.generation
    };
    return postTorqueAgent('/lease/release', payload, request.keepalive ?? false);
  }
};
