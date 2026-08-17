import { useEffect, useRef, useState } from 'react';

import {
  heartbeatTorqueAgentTraining,
  type TorqueAgentLeaseStatus
} from './torqueAgentClient';

export const TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE =
  'レンチ接続を維持できません。検出レンチを確認して接続し直してください。';
export const TORQUE_TRAINING_AGENT_HEARTBEAT_TIMEOUT_MS = 3_000;

type TorqueTrainingAgentHeartbeatPayload = {
  sessionId: string;
  confirmationId: string;
  torqueWrenchProfileId: string;
};

export type TorqueTrainingAgentHeartbeatRequest = (
  payload: TorqueTrainingAgentHeartbeatPayload,
  signal?: AbortSignal
) => Promise<TorqueAgentLeaseStatus>;

export type TorqueTrainingAgentHeartbeatState =
  | { status: 'idle'; error: null }
  | { status: 'connecting'; error: null }
  | { status: 'healthy'; error: null }
  | { status: 'lost'; error: string };

type UseTorqueTrainingAgentHeartbeatOptions = {
  enabled: boolean;
  sessionId: string | null;
  confirmationId: string | null;
  torqueWrenchProfileId: string | null;
  intervalMs?: number;
  heartbeat?: TorqueTrainingAgentHeartbeatRequest;
  onLost?: (message: string) => void;
};

function classifyHeartbeatStatus(status: TorqueAgentLeaseStatus): 'healthy' | 'connecting' | 'lost' {
  // The heartbeat response has no binding identity fields. The page retains
  // session/confirmation/profile IDs locally, so these lease fields are the
  // strongest safe ownership check available from the current API contract.
  if (
    status.ok !== true
    || status.state !== 'owned_by_self'
    || status.leaseOwned !== true
    || status.bound !== true
  ) {
    return 'lost';
  }
  return status.ready === true ? 'healthy' : 'connecting';
}

export function useTorqueTrainingAgentHeartbeat({
  enabled,
  sessionId,
  confirmationId,
  torqueWrenchProfileId,
  intervalMs = 2_000,
  heartbeat = heartbeatTorqueAgentTraining,
  onLost
}: UseTorqueTrainingAgentHeartbeatOptions): TorqueTrainingAgentHeartbeatState {
  const heartbeatRef = useRef(heartbeat);
  const onLostRef = useRef(onLost);
  const [state, setState] = useState<TorqueTrainingAgentHeartbeatState>({ status: 'idle', error: null });

  heartbeatRef.current = heartbeat;
  onLostRef.current = onLost;

  useEffect(() => {
    if (!enabled || !sessionId || !confirmationId || !torqueWrenchProfileId) {
      setState({ status: 'idle', error: null });
      return;
    }

    let cancelled = false;
    let lost = false;
    let nextTimer: number | undefined;
    let activeController: AbortController | null = null;

    const reportLost = (message: string) => {
      if (cancelled || lost) return;
      lost = true;
      setState({ status: 'lost', error: message });
      onLostRef.current?.(message);
    };

    const requestHeartbeat = async (): Promise<TorqueAgentLeaseStatus> => {
      const controller = new AbortController();
      activeController = controller;
      let timeoutId: number | undefined;
      try {
        return await Promise.race([
          heartbeatRef.current({
            sessionId,
            confirmationId,
            torqueWrenchProfileId
          }, controller.signal),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => {
              controller.abort();
              reject(new Error('torque-agent heartbeat timeout'));
            }, TORQUE_TRAINING_AGENT_HEARTBEAT_TIMEOUT_MS);
          })
        ]);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (activeController === controller) activeController = null;
        controller.abort();
      }
    };

    const scheduleNext = () => {
      if (cancelled || lost) return;
      nextTimer = window.setTimeout(() => {
        void sendHeartbeat();
      }, intervalMs);
    };

    const sendHeartbeat = async () => {
      if (cancelled || lost) return;
      try {
        const status = await requestHeartbeat();
        if (cancelled || lost) return;
        const heartbeatState = classifyHeartbeatStatus(status);
        if (heartbeatState === 'lost') {
          reportLost(TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE);
          return;
        }
        setState({ status: heartbeatState, error: null });
        scheduleNext();
      } catch {
        reportLost(TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE);
      }
    };

    // Establish the binding immediately, then keep it alive below the
    // torque-agent's heartbeat TTL while the training session is active.
    // Scheduling only after each response completes guarantees one request in flight.
    void sendHeartbeat();

    return () => {
      cancelled = true;
      if (nextTimer !== undefined) window.clearTimeout(nextTimer);
      activeController?.abort();
    };
  }, [confirmationId, enabled, intervalMs, sessionId, torqueWrenchProfileId]);

  return state;
}
