import { api } from '../../http';

export interface ProductionScheduleLoadBalancingCapacityBaseItem {
  resourceCd: string;
  baseAvailableMinutes: number;
}

export interface ProductionScheduleLoadBalancingMonthlyCapacityItem {
  resourceCd: string;
  availableMinutes: number;
}

export interface ProductionScheduleLoadBalancingClassItem {
  resourceCd: string;
  classCode: string;
}

export interface ProductionScheduleLoadBalancingTransferRuleItem {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  enabled: boolean;
  efficiencyRatio: number;
}

export type ProductionScheduleLoadBalancingWorkCalendarMode = 'weekdays' | 'calendar_days';

export interface ProductionScheduleLoadBalancingWorkCalendarItem {
  resourceCd: string;
  workCalendarMode: ProductionScheduleLoadBalancingWorkCalendarMode;
}

export type ProductionScheduleLoadBalancingStartDateLevelingUnallocatedReason =
  | 'missing_planned_start_date'
  | 'missing_effective_due_date'
  | 'no_active_days'
  | 'zero_required_minutes';

export interface ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fkojun: string | null;
  resourceCd: string;
  reason: ProductionScheduleLoadBalancingStartDateLevelingUnallocatedReason;
  requiredMinutes: number;
}

export type ProductionScheduleLoadBalancingWorkspaceResource = {
  resourceCd: string;
  classCode: string | null;
  workCalendarMode: 'weekdays' | 'calendar_days';
  baseCapacityMinutes: number | null;
  capacityByMonth: Record<string, number | null>;
};

export type ProductionScheduleLoadBalancingWorkspaceRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  machineName: string;
  resourceCd: string;
  totalMinutes: number;
  plannedStartDate: string;
  effectiveDueDate: string;
  late: boolean;
  /** bucket は 'YYYY-MM' または 'late' */
  allocations: Array<{ bucket: string; minutes: number }>;
};

export type ProductionScheduleLoadBalancingWorkspaceTransferRule = {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  efficiencyRatio: number;
};

export interface ProductionScheduleLoadBalancingWorkspaceResponse {
  siteKey: string;
  today: string;
  fromMonth: string;
  toMonth: string;
  months: string[];
  resources: ProductionScheduleLoadBalancingWorkspaceResource[];
  rows: ProductionScheduleLoadBalancingWorkspaceRow[];
  unallocatedRows: ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow[];
  transferRules: ProductionScheduleLoadBalancingWorkspaceTransferRule[];
}

export interface ProductionScheduleLoadBalancingWorkspaceDayResponse {
  siteKey: string;
  month: string;
  resourceCd: string;
  capacityMinutesPerDay: number | null;
  days: Array<{ date: string; requiredMinutes: number }>;
  rowDays: Array<{ rowId: string; date: string; minutes: number }>;
}

export async function getProductionScheduleLoadBalancingCapacityBase(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingCapacityBaseItem[] };
  }>('/production-schedule-settings/load-balancing/capacity-base', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingCapacityBase(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingCapacityBaseItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingCapacityBaseItem[] };
  }>('/production-schedule-settings/load-balancing/capacity-base', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingMonthlyCapacity(location: string, yearMonth: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; yearMonth: string; items: ProductionScheduleLoadBalancingMonthlyCapacityItem[] };
  }>('/production-schedule-settings/load-balancing/monthly-capacity', {
    params: { location, yearMonth }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingMonthlyCapacity(payload: {
  location: string;
  yearMonth: string;
  items: ProductionScheduleLoadBalancingMonthlyCapacityItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; yearMonth: string; items: ProductionScheduleLoadBalancingMonthlyCapacityItem[] };
  }>('/production-schedule-settings/load-balancing/monthly-capacity', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingClasses(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingClassItem[] };
  }>('/production-schedule-settings/load-balancing/classes', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingClasses(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingClassItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingClassItem[] };
  }>('/production-schedule-settings/load-balancing/classes', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingTransferRules(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingTransferRuleItem[] };
  }>('/production-schedule-settings/load-balancing/transfer-rules', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingTransferRules(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingTransferRuleItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingTransferRuleItem[] };
  }>('/production-schedule-settings/load-balancing/transfer-rules', payload);
  return data.settings;
}

export async function getProductionScheduleLoadBalancingWorkCalendars(location: string) {
  const { data } = await api.get<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingWorkCalendarItem[] };
  }>('/production-schedule-settings/load-balancing/work-calendars', {
    params: { location }
  });
  return data.settings;
}

export async function updateProductionScheduleLoadBalancingWorkCalendars(payload: {
  location: string;
  items: ProductionScheduleLoadBalancingWorkCalendarItem[];
}) {
  const { data } = await api.put<{
    settings: { siteKey: string; items: ProductionScheduleLoadBalancingWorkCalendarItem[] };
  }>('/production-schedule-settings/load-balancing/work-calendars', payload);
  return data.settings;
}

export async function getKioskProductionScheduleLoadBalancingWorkspace(params: {
  fromMonth: string;
  toMonth: string;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<ProductionScheduleLoadBalancingWorkspaceResponse>(
    '/kiosk/production-schedule/load-balancing/workspace',
    { params }
  );
  return data;
}

export async function getKioskProductionScheduleLoadBalancingWorkspaceDay(params: {
  month: string;
  resourceCd: string;
  fromMonth?: string;
  toMonth?: string;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<ProductionScheduleLoadBalancingWorkspaceDayResponse>(
    '/kiosk/production-schedule/load-balancing/workspace/day',
    { params }
  );
  return data;
}

export async function putKioskProductionScheduleLoadBalancingCapacityBase(payload: {
  resourceCd: string;
  baseAvailableMinutes: number;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.put<{
    siteKey: string;
    items: Array<{ resourceCd: string; baseAvailableMinutes: number }>;
  }>('/kiosk/production-schedule/load-balancing/capacity-base', payload);
  return data;
}
