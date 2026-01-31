export interface VisualizationDashboardQuery {
  enabled?: boolean;
  search?: string;
}

export interface VisualizationDashboardCreateInput {
  name: string;
  description?: string | null;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: Record<string, unknown>;
  rendererConfig: Record<string, unknown>;
  enabled?: boolean;
}

export interface VisualizationDashboardUpdateInput {
  name?: string;
  description?: string | null;
  dataSourceType?: string;
  rendererType?: string;
  dataSourceConfig?: Record<string, unknown>;
  rendererConfig?: Record<string, unknown>;
  enabled?: boolean;
}
