import type { getTransactions, getUnifiedItems } from '../client';

export const toolsQueryKeys = {
  machinesAll: ['machines'] as const,
  machines: (params?: { search?: string; operatingStatus?: string }) => ['machines', params] as const,
  uninspectedMachinesAll: ['machines-uninspected'] as const,
  uninspectedMachines: (params?: { csvDashboardId?: string; date?: string }) => ['machines-uninspected', params] as const,
  loansAll: ['loans'] as const,
  loans: (clientId?: string, clientKey?: string) => ['loans', clientId, clientKey] as const,
  departmentsAll: ['departments'] as const,
  employeesAll: ['employees'] as const,
  itemsAll: ['items'] as const,
  photoLabelReviewsAll: ['photo-label-reviews'] as const,
  photoLabelReviews: (limit: number) => ['photo-label-reviews', limit] as const,
  photoSimilarCandidates: (loanId: string) => ['photo-similar-candidates', loanId] as const,
  transactions: (page: number, filters?: Parameters<typeof getTransactions>[1]) =>
    ['transactions', page, filters] as const,
  unifiedItems: (params?: Parameters<typeof getUnifiedItems>[0]) => ['unified-items', params] as const,
};
