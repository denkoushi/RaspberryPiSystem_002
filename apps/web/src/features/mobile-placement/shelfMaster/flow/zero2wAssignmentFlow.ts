export type Zero2wEmphasis = 'device' | 'mapShelf' | 'save' | null;

export type Zero2wAssignmentFlowGates = {
  deviceSelect: boolean;
  /** Pi 選択後、factory-map の SHELF セルをタップして担当棚を指定 */
  mapShelfPick: boolean;
  save: boolean;
  emphasize: Zero2wEmphasis;
};

export function getZero2wAssignmentFlowGates(input: {
  selectedDeviceId: string;
  selectedShelf: string;
  savePending: boolean;
  layoutCellsSelected: boolean;
}): Zero2wAssignmentFlowGates {
  const hasDevice = input.selectedDeviceId.length > 0;
  const hasShelf = input.selectedShelf.length > 0;
  const mapShelfPick = hasDevice && !input.savePending && !input.layoutCellsSelected;

  let emphasize: Zero2wEmphasis = 'device';
  if (hasDevice && hasShelf) {
    emphasize = 'save';
  } else if (mapShelfPick) {
    emphasize = 'mapShelf';
  }

  return {
    deviceSelect: !input.savePending,
    mapShelfPick,
    save: hasDevice && hasShelf && !input.savePending,
    emphasize
  };
}
