export const tagDeskQueryKeys = {
  registryAll: ['kiosk-tag-desk', 'registry'] as const,
  optionsAll: ['kiosk-tag-desk', 'options'] as const,
  eventsAll: ['kiosk-tag-desk', 'events'] as const,
  tagAll: ['kiosk-tag-desk', 'tag'] as const,
  positionRanksAll: ['kiosk-tag-desk', 'position-ranks'] as const,
  section: (key: string) => ['kiosk-tag-desk', key] as const,
  registry: (kind: string) => ['kiosk-tag-desk', 'registry', kind] as const,
  tag: (uid: string | null) => ['kiosk-tag-desk', 'tag', uid] as const,
  riggingInspections: (riggingGearId: string) => ['kiosk-tag-desk', 'rigging-inspections', riggingGearId] as const,
};
