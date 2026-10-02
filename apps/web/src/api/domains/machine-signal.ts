import { api } from '../http';

/** 機械をまたいで比較する共通6区分。timeline の区分 index はこの順。 */
export const MACHINE_SIGNAL_CATEGORIES = ['RUN', 'RUN_ALARM', 'STOP', 'ALARM_STOP', 'IDLE', 'NO_RECORD'] as const;
export type MachineSignalCategory = (typeof MACHINE_SIGNAL_CATEGORIES)[number];

export type MachineSignalHint = 'ALARM' | 'SHORT_STOPS' | 'LONG_STOP' | 'BARELY_RAN' | 'NONE' | 'NO_RECORD' | 'GOOD';
export type MachineSignalSensorKind = 'MACHINE' | 'ROBOT' | 'LINE' | 'OTHER';
export type MachineSignalTrendDays = 30 | 90;

export type MachineSignalLoss = {
  normalRunSeconds: number;
  runAlarmSeconds: number;
  shortStopSeconds: number;
  midStopSeconds: number;
  longStopSeconds: number;
  notStartedSeconds: number;
  outsidePlanSeconds: number;
  noRecordSeconds: number;
};

export type MachineSignalStop = { startSecond: number; durationSeconds: number; stateName: string };

export type MachineSignalMachineDay = {
  signalNo: number;
  name: string;
  sourceMachineName: string;
  site: string | null;
  kind: MachineSignalSensorKind;
  hint: MachineSignalHint;
  hasRecord: boolean;
  /** [開始秒, 継続秒, 区分index] */
  timeline: Array<[number, number, number]>;
  categorySeconds: number[];
  runSeconds: number;
  runBlockCount: number;
  averageRunSeconds: number;
  longestRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  stopBuckets: Array<{ count: number; seconds: number }>;
  longestStops: MachineSignalStop[];
  alarmCount: number;
  alarmSeconds: number;
  loss: MachineSignalLoss;
  estimatedKwh: number | null;
};

export type MachineSignalWorsening = {
  signalNo: number;
  kind: 'RUN_SHORTER' | 'ALARM_MORE' | 'SHORT_STOPS_MORE';
  recent: number;
  baseline: number;
};

export type MachineSignalFleetDay = {
  machineCount: number;
  runRatio: number;
  loss: MachineSignalLoss;
  runningBins: number[];
  dayAverage: number | null;
  nightAverage: number | null;
  hintCounts: Record<MachineSignalHint, number>;
  estimatedKwh: number | null;
  topAlarm: number[];
  topShortStops: number[];
  topLongStop: number[];
  worsening: MachineSignalWorsening[];
};

export type MachineSignalDay = {
  reportDate: string | null;
  previousDate: string | null;
  nextDate: string | null;
  dayStartMinute: number;
  nightStartMinute: number;
  thresholds: MachineSignalThresholds;
  sites: string[];
  fleet: MachineSignalFleetDay | null;
  machines: MachineSignalMachineDay[];
};

export type MachineSignalTrendPoint = {
  reportDate: string;
  runSeconds: number;
  averageRunSeconds: number;
  stopCount: number;
  shortStopCount: number;
  alarmCount: number;
  alarmSeconds: number;
};

export type MachineSignalThresholds = {
  shortStopMaxSeconds: number;
  longStopMinSeconds: number;
  shortStopCountForHint: number;
  alarmSecondsForHint: number;
  alarmCountForHint: number;
  barelyRanMaxSeconds: number;
  goodRunMinSeconds: number;
  worseningPercent: number;
};

export type MachineSignalSettings = {
  nightStartMinute: number;
  thresholds: MachineSignalThresholds;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type MachineSignalSensorInput = {
  displayName: string | null;
  site: string | null;
  kind: MachineSignalSensorKind;
  hidden: boolean;
  plannedStartMinute: number | null;
  plannedEndMinute: number | null;
  runningKw: number | null;
  idleKw: number | null;
  categoryOverrides: Record<string, MachineSignalCategory>;
};

export type MachineSignalSensor = MachineSignalSensorInput & {
  signalNo: number;
  sourceMachineName: string;
  latestReportDate: string | null;
  lampPatterns: Array<{ pattern: string; stateNames: string[]; autoCategory: MachineSignalCategory }>;
  /** 最新の日報の状態遷移。[開始秒, 継続秒, lampPatterns の index] */
  latestSegments: Array<[number, number, number]>;
};

export type MachineSignalSensorBulkPatch = {
  site?: string | null;
  kind?: MachineSignalSensorKind;
  hidden?: boolean;
  planned?: { startMinute: number; endMinute: number } | null;
};

export type MachineSignalAdminOverview = {
  latestReportDate: string | null;
  latestReportCount: number;
  coverage: Array<{ date: string; count: number }>;
  gmailSchedule: { schedule: string; enabled: boolean };
};

export type MachineSignalImportFailure = { fileName: string; reason: string };

export type MachineSignalImportSummary = {
  runId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  fileCount: number;
  importedCount: number;
  failedCount: number;
  failures: MachineSignalImportFailure[];
  reportDates: string[];
};

export type MachineSignalImportRun = {
  id: string;
  source: string;
  status: string;
  fileCount: number;
  importedCount: number;
  failedCount: number;
  failures: MachineSignalImportFailure[];
  startedAt: string;
};

export type MachineSignalGmailSummary = {
  scanned: number;
  processed: number;
  skipped: number;
  runs: MachineSignalImportSummary[];
};

export async function getMachineSignalDay(params: { date?: string; site?: string }): Promise<MachineSignalDay> {
  const { data } = await api.get<MachineSignalDay>('/machine-signal/day', { params });
  return data;
}

export async function getMachineSignalTrend(params: {
  signalNo: number;
  endDate: string;
  days: MachineSignalTrendDays;
}): Promise<MachineSignalTrendPoint[]> {
  const { data } = await api.get<{ points: MachineSignalTrendPoint[] }>(
    `/machine-signal/sensors/${params.signalNo}/trend`,
    { params: { endDate: params.endDate, days: params.days } }
  );
  return data.points;
}

export async function getMachineSignalSettings(): Promise<MachineSignalSettings> {
  const { data } = await api.get<{ settings: MachineSignalSettings }>('/machine-signal/settings');
  return data.settings;
}

export async function updateMachineSignalSettings(payload: {
  nightStartMinute: number;
  thresholds: MachineSignalThresholds;
}): Promise<MachineSignalSettings> {
  const { data } = await api.put<{ settings: MachineSignalSettings }>('/machine-signal/settings', payload);
  return data.settings;
}

export async function getMachineSignalSensors(): Promise<MachineSignalSensor[]> {
  const { data } = await api.get<{ sensors: MachineSignalSensor[] }>('/machine-signal/sensors');
  return data.sensors;
}

export async function updateMachineSignalSensor(payload: {
  signalNo: number;
  input: MachineSignalSensorInput;
}): Promise<void> {
  await api.put(`/machine-signal/sensors/${payload.signalNo}`, payload.input);
}

export async function updateMachineSignalSensorsBulk(payload: {
  signalNos: number[];
  patch: MachineSignalSensorBulkPatch;
}): Promise<number> {
  const { data } = await api.put<{ updated: number }>('/machine-signal/sensors/bulk', payload);
  return data.updated;
}

export async function getMachineSignalAdminOverview(): Promise<MachineSignalAdminOverview> {
  const { data } = await api.get<{ overview: MachineSignalAdminOverview }>('/machine-signal/admin/overview');
  return data.overview;
}

export async function getMachineSignalImportRuns(): Promise<MachineSignalImportRun[]> {
  const { data } = await api.get<{ runs: MachineSignalImportRun[] }>('/machine-signal/import-runs');
  return data.runs;
}

export async function uploadMachineSignalReports(files: File[]): Promise<MachineSignalImportSummary> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  const { data } = await api.post<{ run: MachineSignalImportSummary }>('/machine-signal/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data.run;
}

export async function runMachineSignalGmailImport(): Promise<MachineSignalGmailSummary> {
  const { data } = await api.post<{ summary: MachineSignalGmailSummary }>('/machine-signal/gmail-import/run');
  return data.summary;
}
