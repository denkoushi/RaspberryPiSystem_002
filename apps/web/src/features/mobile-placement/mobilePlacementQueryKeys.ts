export const mobilePlacementQueryKeys = {
  all: ['mobile-placement'] as const,
  registeredShelves: ['mobile-placement', 'registered-shelves'] as const,
  haizenTargetDevices: ['mobile-placement', 'haizen-target-devices'] as const,
  orderPlacementBranchesAll: ['mobile-placement', 'order-placement-branches'] as const,
  orderPlacementBranches: (key: string) => ['mobile-placement', 'order-placement-branches', key] as const,
  haizenCurrent: (shelf: string) => ['mobile-placement', 'haizen-current', shelf || '__all__'] as const,
  clientCapabilities: ['mobile-placement', 'client-capabilities'] as const,
  shelfLayout: ['mobile-placement', 'shelf-layout'] as const,
  shelfLayoutZone: (macroZoneId: string | null) => ['mobile-placement', 'shelf-layout', 'zone', macroZoneId] as const,
  shelfMachines: ['mobile-placement', 'shelf-machines'] as const,
  machineMasters: ['mobile-placement', 'machine-masters'] as const,
  partSearch: (partQuery: string, machineQuery: string) => ['mobile-placement-part-search', partQuery, machineQuery] as const,
};
