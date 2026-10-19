import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCsvDashboards,
  getVisualizationDashboards,
  getVisualizationDashboard,
  createVisualizationDashboard,
  updateVisualizationDashboard,
  deleteVisualizationDashboard
} from '../client';
import { csvVisualizationQueryKeys } from '../queryKeys/csvVisualization';

export function useCsvDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: csvVisualizationQueryKeys.csvDashboards(filters),
    queryFn: () => getCsvDashboards(filters)
  });
}

export function useVisualizationDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: csvVisualizationQueryKeys.visualizationDashboards(filters),
    queryFn: () => getVisualizationDashboards(filters)
  });
}

export function useVisualizationDashboard(id?: string | null) {
  return useQuery({
    queryKey: csvVisualizationQueryKeys.visualizationDashboard(id),
    queryFn: () => getVisualizationDashboard(id!),
    enabled: Boolean(id)
  });
}

export function useVisualizationDashboardMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createVisualizationDashboard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboardsAll });
    }
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateVisualizationDashboard>[1] }) =>
      updateVisualizationDashboard(id, payload),
    onSuccess: (dashboard) => {
      queryClient.invalidateQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboard(dashboard.id) });
      queryClient.invalidateQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboardsAll });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteVisualizationDashboard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: csvVisualizationQueryKeys.visualizationDashboardsAll });
    }
  });
  return { create, update, remove };
}
