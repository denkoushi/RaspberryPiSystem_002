import { api } from '../http';

// CSVダッシュボード関連の型定義
export interface CsvDashboard {
  id: string;
  name: string;
  description: string | null;
  columnDefinitions: Array<{
    internalName: string;
    displayName: string;
    csvHeaderCandidates: string[];
    dataType: 'string' | 'number' | 'date' | 'boolean';
    order: number;
    required?: boolean;
  }>;
  dateColumnName: string | null;
  displayPeriodDays: number;
  emptyMessage: string | null;
  ingestMode: 'APPEND' | 'DEDUP';
  dedupKeyColumns: string[];
  gmailScheduleId: string | null;
  gmailSubjectPattern: string | null; // Gmail件名パターン（CSV取得用）
  templateType: 'TABLE' | 'CARD_GRID';
  templateConfig: Record<string, unknown>;
  csvFilePath: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VisualizationDashboard {
  id: string;
  name: string;
  description: string | null;
  dataSourceType: string;
  rendererType: string;
  dataSourceConfig: Record<string, unknown>;
  rendererConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface CsvPreviewResult {
  headers: string[];
  sampleRows: Array<Record<string, unknown>>;
  detectedTypes: Record<string, 'string' | 'number' | 'date' | 'boolean'>;
}

export async function getCsvDashboards(filters?: { enabled?: boolean; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.enabled !== undefined) {
    params.append('enabled', String(filters.enabled));
  }
  if (filters?.search) {
    params.append('search', filters.search);
  }
  const { data } = await api.get<{ dashboards: CsvDashboard[] }>(`/csv-dashboards?${params.toString()}`);
  return data.dashboards;
}

export async function getVisualizationDashboards(filters?: { enabled?: boolean; search?: string }) {
  const params = new URLSearchParams();
  if (filters?.enabled !== undefined) {
    params.append('enabled', String(filters.enabled));
  }
  if (filters?.search) {
    params.append('search', filters.search);
  }
  const { data } = await api.get<{ dashboards: VisualizationDashboard[] }>(`/visualizations?${params.toString()}`);
  return data.dashboards;
}

export async function getVisualizationDashboard(id: string) {
  const { data } = await api.get<{ dashboard: VisualizationDashboard }>(`/visualizations/${id}`);
  return data.dashboard;
}

export async function createVisualizationDashboard(payload: VisualizationDashboardCreateInput) {
  const { data } = await api.post<{ dashboard: VisualizationDashboard }>('/visualizations', payload);
  return data.dashboard;
}

export async function updateVisualizationDashboard(id: string, payload: VisualizationDashboardUpdateInput) {
  const { data } = await api.put<{ dashboard: VisualizationDashboard }>(`/visualizations/${id}`, payload);
  return data.dashboard;
}

export async function deleteVisualizationDashboard(id: string) {
  const { data } = await api.delete<{ success: true }>(`/visualizations/${id}`);
  return data;
}

export async function getCsvDashboard(id: string) {
  const { data } = await api.get<{ dashboard: CsvDashboard }>(`/csv-dashboards/${id}`);
  return data.dashboard;
}

export interface CsvDashboardCreateInput {
  name: string;
  description?: string | null;
  columnDefinitions: CsvDashboard['columnDefinitions'];
  dateColumnName?: string | null;
  displayPeriodDays?: number;
  emptyMessage?: string | null;
  ingestMode?: 'APPEND' | 'DEDUP';
  dedupKeyColumns?: string[];
  gmailScheduleId?: string | null;
  gmailSubjectPattern?: string | null;
  templateType?: 'TABLE' | 'CARD_GRID';
  templateConfig: Record<string, unknown>;
}

export async function createCsvDashboard(payload: CsvDashboardCreateInput) {
  const { data } = await api.post<{ dashboard: CsvDashboard }>('/csv-dashboards', payload);
  return data.dashboard;
}

export async function updateCsvDashboard(
  id: string,
  payload: Partial<Pick<CsvDashboard, 'name' | 'description' | 'columnDefinitions' | 'dateColumnName' | 'displayPeriodDays' | 'emptyMessage' | 'ingestMode' | 'dedupKeyColumns' | 'gmailScheduleId' | 'gmailSubjectPattern' | 'templateType' | 'templateConfig' | 'enabled'>>
) {
  const { data } = await api.put<{ dashboard: CsvDashboard }>(`/csv-dashboards/${id}`, payload);
  return data.dashboard;
}

export async function uploadCsvToDashboard(id: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ preview: unknown; ingestResult: unknown }>(`/csv-dashboards/${id}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function previewCsvDashboardParse(id: string, csvContent: string) {
  const { data } = await api.post<{ preview: CsvPreviewResult }>(`/csv-dashboards/${id}/preview-parse`, { csvContent });
  return data.preview;
}
