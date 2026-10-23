import { api } from '../../http';

export interface ProductionScheduleResourceCategorySettings {
  location: string;
  cuttingExcludedResourceCds: string[];
}

export interface ProductionScheduleDueManagementAccessPasswordSettings {
  location: string;
  configured: boolean;
  defaultPasswordActive: boolean;
}

export interface ProductionScheduleOrderSplitPilotSettings {
  deploymentEnabled: boolean;
  runtimeEnabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProductionScheduleProcessingTypeOption {
  code: string;
  label: string;
  priority: number;
  enabled: boolean;
}

export interface ProductionScheduleResourceCodeMapping {
  fromResourceCd: string;
  toResourceCd: string;
  priority: number;
  enabled: boolean;
}

export interface ProductionScheduleResourceCodeMappingsImportResult {
  location: string;
  dryRun: boolean;
  totalRows: number;
  rowsWithGroupCd: number;
  generatedMappings: number;
  skippedEmptyRows: number;
  skippedDuplicateRows: number;
  skippedUnknownResourceCds: string[];
  settings?: {
    location: string;
    mappings: ProductionScheduleResourceCodeMapping[];
  };
}

export async function getKioskProductionScheduleProcessingTypeOptions() {
  const { data } = await api.get<{ options: ProductionScheduleProcessingTypeOption[] }>(
    '/kiosk/production-schedule/processing-type-options'
  );
  return data.options;
}

export async function getProductionScheduleResourceCategorySettings(location: string) {
  const { data } = await api.get<{
    settings: ProductionScheduleResourceCategorySettings;
    locations: string[];
  }>('/production-schedule-settings/resource-categories', {
    params: { location }
  });
  return data;
}

export async function getProductionScheduleProcessingTypeOptions(location: string) {
  const { data } = await api.get<{
    settings: {
      location: string;
      options: ProductionScheduleProcessingTypeOption[];
    };
    locations: string[];
  }>('/production-schedule-settings/processing-type-options', {
    params: { location }
  });
  return data;
}

export async function getProductionScheduleResourceCodeMappings(location: string) {
  const { data } = await api.get<{
    settings: {
      location: string;
      mappings: ProductionScheduleResourceCodeMapping[];
    };
    locations: string[];
  }>('/production-schedule-settings/resource-code-mappings', {
    params: { location }
  });
  return data;
}

export async function updateProductionScheduleResourceCodeMappings(payload: {
  location: string;
  mappings: ProductionScheduleResourceCodeMapping[];
}) {
  const { data } = await api.put<{
    settings: {
      location: string;
      mappings: ProductionScheduleResourceCodeMapping[];
    };
  }>('/production-schedule-settings/resource-code-mappings', payload);
  return data.settings;
}

export async function importProductionScheduleResourceCodeMappingsFromCsv(payload: {
  location: string;
  csvText: string;
  dryRun: boolean;
}) {
  const { data } = await api.post<{
    result: ProductionScheduleResourceCodeMappingsImportResult;
  }>('/production-schedule-settings/resource-code-mappings/import-csv', payload);
  return data.result;
}

export async function updateProductionScheduleProcessingTypeOptions(payload: {
  location: string;
  options: ProductionScheduleProcessingTypeOption[];
}) {
  const { data } = await api.put<{
    settings: {
      location: string;
      options: ProductionScheduleProcessingTypeOption[];
    };
  }>('/production-schedule-settings/processing-type-options', payload);
  return data.settings;
}

export async function updateProductionScheduleResourceCategorySettings(payload: {
  location: string;
  cuttingExcludedResourceCds: string[];
}) {
  const { data } = await api.put<{ settings: ProductionScheduleResourceCategorySettings }>(
    '/production-schedule-settings/resource-categories',
    payload
  );
  return data.settings;
}

export async function getProductionScheduleDueManagementAccessPasswordSettings(location: string) {
  const { data } = await api.get<{
    settings: ProductionScheduleDueManagementAccessPasswordSettings;
  }>('/production-schedule-settings/due-management-access-password', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleDueManagementAccessPassword(payload: {
  location: string;
  password: string;
}) {
  const { data } = await api.put<{
    settings: ProductionScheduleDueManagementAccessPasswordSettings;
  }>('/production-schedule-settings/due-management-access-password', payload);
  return data.settings;
}

export async function getProductionScheduleOrderSplitPilotSettings() {
  const { data } = await api.get<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/production-schedule-settings/order-split-pilot');
  return data.settings;
}

export async function updateProductionScheduleOrderSplitPilotSettings(payload: {
  enabled: boolean;
}) {
  const { data } = await api.put<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/production-schedule-settings/order-split-pilot', payload);
  return data.settings;
}
