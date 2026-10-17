export const toolsQueryKeys = {
  machinesAll: ['machines'] as const,
  machines: (params?: { search?: string; operatingStatus?: string }) => ['machines', params] as const,
  uninspectedMachinesAll: ['machines-uninspected'] as const,
  uninspectedMachines: (params?: { csvDashboardId?: string; date?: string }) => ['machines-uninspected', params] as const,
  loansAll: ['loans'] as const,
  loans: (clientId?: string, clientKey?: string) => ['loans', clientId, clientKey] as const,
};
