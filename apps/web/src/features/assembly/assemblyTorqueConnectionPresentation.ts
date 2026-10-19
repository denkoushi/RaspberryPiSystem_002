/** Compatibility adapter for the shared torque-wrench presentation. */

import {
  resolveTorqueWrenchConnectionPresentation
} from '../torque-wrench-connection';

import type { TorqueAgentLeaseStatus } from '../torque-wrench-connection';

export type TorqueAgentReachability = 'unknown' | 'reachable' | 'unreachable';
export type TorqueConfirmationLookupState = 'idle' | 'loading' | 'resolved';

export type TorqueConnectionPresentation = {
  stateLabel: string;
  connectionMessage: string | null;
};

type TorqueConnectionPresentationInput = {
  currentTemplateBoltId: string | null;
  confirmationLookupState: TorqueConfirmationLookupState;
  hasConfirmation: boolean;
  reachability: TorqueAgentReachability;
  status: TorqueAgentLeaseStatus | null;
};

function legacyState(input: TorqueConnectionPresentationInput) {
  if (input.reachability === 'unreachable') return 'communication_lost' as const;
  if (!input.status) return 'available' as const;
  if (input.status.state === 'owned_by_other') return 'owned_by_other' as const;
  if (input.status.state === 'handoff_wait') return 'handoff_wait' as const;
  if (input.status.state === 'communication_lost') return 'communication_lost' as const;
  if (input.status.state === 'fenced') return 'fenced' as const;
  if (input.status.state === 'owned_by_self' && input.status.ready) return 'ready' as const;
  if (input.status.state === 'owned_by_self') return 'owned_by_self' as const;
  return 'available' as const;
}

export function resolveTorqueConnectionPresentation(
  input: TorqueConnectionPresentationInput
): TorqueConnectionPresentation {
  const result = resolveTorqueWrenchConnectionPresentation({
    ...input,
    state: legacyState(input)
  });
  return {
    stateLabel: result.stateLabel,
    connectionMessage: result.connectionMessage
  };
}
