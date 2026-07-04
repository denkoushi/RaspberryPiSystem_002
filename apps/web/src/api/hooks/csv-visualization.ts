import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCsvDashboards,
  getVisualizationDashboards,
  getVisualizationDashboard,
  createVisualizationDashboard,
  updateVisualizationDashboard,
  deleteVisualizationDashboard
} from '../client';

export function useCsvDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: ['csv-dashboards', filters],
    queryFn: () => getCsvDashboards(filters)
  });
}

export function useVisualizationDashboards(filters?: { enabled?: boolean; search?: string }) {
  return useQuery({
    queryKey: ['visualization-dashboards', filters],
    queryFn: () => getVisualizationDashboards(filters)
  });
}

export function useVisualizationDashboard(id?: string | null) {
  return useQuery({
    queryKey: ['visualization-dashboard', id],
    queryFn: () => getVisualizationDashboard(id!),
    enabled: Boolean(id)
  });
}

export function useVisualizationDashboardMutations() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createVisualizationDashboard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateVisualizationDashboard>[1] }) =>
      updateVisualizationDashboard(id, payload),
    onSuccess: (dashboard) => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboard', dashboard.id] });
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteVisualizationDashboard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visualization-dashboards'] });
    }
  });
  return { create, update, remove };
}
