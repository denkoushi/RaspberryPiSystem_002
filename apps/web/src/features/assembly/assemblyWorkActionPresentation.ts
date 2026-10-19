export type AssemblyActionPresentation = {
  disabled: boolean;
  highlighted: boolean;
};

export type AssemblyWorkActionPresentation = {
  recordTorque: AssemblyActionPresentation;
  advanceArea: AssemblyActionPresentation;
  restartArea: AssemblyActionPresentation;
  complete: AssemblyActionPresentation;
  confirmPhysicalWrench: AssemblyActionPresentation;
  startUsingWrench: AssemblyActionPresentation;
  stopUsingWrench: AssemblyActionPresentation;
};

export function resolveAssemblyWorkActionPresentation(input: {
  sessionActive: boolean;
  busy: boolean;
  hasCurrentBolt: boolean;
  hasCurrentArea: boolean;
  allBoltsComplete: boolean;
  canComplete: boolean;
  torqueValueValid: boolean;
  selectedProfileId: string;
  hasConfirmation: boolean;
  leaseOwned: boolean;
  ownedByOther: boolean;
}): AssemblyWorkActionPresentation {
  const idle = input.sessionActive && !input.busy;
  const canRecord = idle && input.hasCurrentBolt && input.torqueValueValid;
  const canAdvance = idle && !input.hasCurrentBolt && !input.allBoltsComplete;
  const canComplete = idle && input.canComplete;
  const canConfirm = idle && input.hasCurrentBolt && Boolean(input.selectedProfileId) && !input.hasConfirmation;
  const canStart = idle && input.hasCurrentBolt && input.hasConfirmation && !input.leaseOwned && !input.ownedByOther;
  const canStop = idle && input.leaseOwned;

  return {
    recordTorque: { disabled: !canRecord, highlighted: canRecord },
    advanceArea: { disabled: !canAdvance, highlighted: canAdvance },
    restartArea: { disabled: !idle || !input.hasCurrentArea, highlighted: false },
    complete: { disabled: !canComplete, highlighted: canComplete },
    confirmPhysicalWrench: { disabled: !canConfirm, highlighted: canConfirm },
    startUsingWrench: { disabled: !canStart, highlighted: canStart },
    stopUsingWrench: { disabled: !canStop, highlighted: false }
  };
}
