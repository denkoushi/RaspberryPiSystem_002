export type Zero2wEmphasis = 'device' | 'shelf' | 'save' | null;

export type Zero2wAssignmentFlowGates = {
  deviceSelect: boolean;
  shelfChips: boolean;
  save: boolean;
  emphasize: Zero2wEmphasis;
};

export function getZero2wAssignmentFlowGates(input: {
  selectedDeviceId: string;
  selectedShelf: string;
  savePending: boolean;
}): Zero2wAssignmentFlowGates {
  const hasDevice = input.selectedDeviceId.length > 0;
  const hasShelf = input.selectedShelf.length > 0;

  let emphasize: Zero2wEmphasis = 'device';
  if (hasDevice && hasShelf) {
    emphasize = 'save';
  } else if (hasDevice) {
    emphasize = 'shelf';
  }

  return {
    deviceSelect: !input.savePending,
    shelfChips: hasDevice && !input.savePending,
    save: hasDevice && hasShelf && !input.savePending,
    emphasize
  };
}
