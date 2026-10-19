/**
 * Compatibility facade for existing assembly imports.
 * New code should consume `features/torque-wrench-connection` directly.
 */

import {
  localhostTorqueWrenchTransport,
  TORQUE_AGENT_STREAM_URL
} from '../torque-wrench-connection';

export {
  TORQUE_AGENT_STREAM_URL,
  localhostTorqueWrenchTransport
};

export type {
  TorqueAgentLeaseStatus,
  TorqueAgentWireLeaseState as TorqueAgentLeaseState,
  TorqueWrenchConnectionBinding,
  TorqueWrenchConnectionOwner,
  TorqueWrenchConnectionTargetKind,
  TorqueWrenchConnectionTransport,
  TorqueWrenchLocalLeaseToken
} from '../torque-wrench-connection';

import type {
  TorqueAgentLeaseStatus,
  TorqueWrenchConnectionTargetKind,
  TorqueWrenchLocalLeaseToken
} from '../torque-wrench-connection';

export function getTorqueAgentHealth(signal?: AbortSignal): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.health(signal);
}

export function heartbeatTorqueAgent(
  payload: {
    sessionId: string;
    currentTemplateBoltId: string | null;
    confirmationId: string | null;
    torqueWrenchProfileId: string | null;
    targetKind?: TorqueWrenchConnectionTargetKind;
  },
  signal?: AbortSignal
): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.heartbeat({
    sessionId: payload.sessionId,
    currentTemplateBoltId: payload.currentTemplateBoltId,
    confirmationId: payload.confirmationId ?? '',
    torqueWrenchProfileId: payload.torqueWrenchProfileId ?? '',
    targetKind: payload.targetKind ?? 'assembly'
  }, signal);
}
export function acquireTorqueAgentLease(payload: {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
  targetKind?: TorqueWrenchConnectionTargetKind;
}): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.acquire({ ...payload, targetKind: payload.targetKind ?? 'assembly' });
}

export function takeoverTorqueAgentLease(payload: {
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
  physicalWrenchPresent: true;
  reason: string;
  targetKind?: TorqueWrenchConnectionTargetKind;
}): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.takeover({ ...payload, targetKind: payload.targetKind ?? 'assembly' });
}

/** Legacy release signature retained for existing completion flows. */
export function releaseTorqueAgentLease(
  reason: string,
  token: TorqueWrenchLocalLeaseToken,
  keepalive = false
): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.release({ reason, keepalive, token });
}

/** Exact-token variant used by the shared connection controller. */
export function releaseTorqueAgentLeaseExact(request: {
  reason: string;
  token: TorqueWrenchLocalLeaseToken;
  keepalive?: boolean;
}): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.release(request);
}

export function acquireTorqueAgentTrainingLease(payload: {
  sessionId: string;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
}): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.acquire({
    ...payload,
    currentTemplateBoltId: null,
    targetKind: 'training'
  });
}

export function takeoverTorqueAgentTrainingLease(payload: {
  sessionId: string;
  confirmationId: string;
  torqueWrenchProfileId: string;
  requestId: string;
  physicalWrenchPresent: true;
  reason: string;
}): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.takeover({
    ...payload,
    currentTemplateBoltId: null,
    targetKind: 'training'
  });
}

export function heartbeatTorqueAgentTraining(payload: {
  sessionId: string;
  confirmationId: string | null;
  torqueWrenchProfileId: string | null;
}, signal?: AbortSignal): Promise<TorqueAgentLeaseStatus> {
  return localhostTorqueWrenchTransport.heartbeat({
    ...payload,
    currentTemplateBoltId: null,
    confirmationId: payload.confirmationId ?? '',
    torqueWrenchProfileId: payload.torqueWrenchProfileId ?? '',
    targetKind: 'training'
  }, signal);
}
