/** `invalidateInventory` refreshes every entry here, so keep only the prefix keys in this object. */
export const inventoryKeys = {
  dashboardAll: ['inventory-dashboard'] as const,
  variantsAll: ['inventory-value-variants'] as const,
  itemsAll: ['inventory-items'] as const,
  locationsAll: ['inventory-locations'] as const,
  tagsAll: ['inventory-tags'] as const,
  importsAll: ['inventory-imports'] as const,
  // Under `imports`, so anything that refreshes the candidates refreshes this list too.
  importSummariesAll: ['inventory-imports', 'summaries'] as const,
  historyAll: ['inventory-history'] as const,
  importMessagesAll: ['inventory-import-messages'] as const,
  unitsAll: ['inventory-units'] as const,
  toolFieldOptionsAll: ['inventory-tool-field-options'] as const,
  toolFieldValuesAll: ['inventory-tool-field-values'] as const,
};

export const itemInventoryQueryKeys = {
  toolFieldValuesSetup: (generation: number) => ['inventory-tool-field-values', 'setup', generation] as const,
  importsSetup: (generation: number) => ['inventory-imports', 'setup', generation] as const,
  importMessagesSetup: (generation: number) => ['inventory-import-messages', 'setup', generation] as const,
  compartmentHistory: (compartmentId: string | null, limit: number) => ['inventory-history', compartmentId, limit] as const,
  tag: (uid: string) => ['inventory-tag', uid] as const,
  label: (labelNumber: string) => ['inventory-label', labelNumber] as const,
  dashboard: (weeks: number, machine: string | undefined) => ['inventory-dashboard', weeks, machine] as const,
};
