import type { MachineSignalSensor, Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  DEFAULT_SIGNAL_THRESHOLDS,
  type SignalCategoryOverrides,
  type SignalThresholds,
} from './signal-metrics.js';
import { SIGNAL_CATEGORIES, type SignalCategory } from './signal-report.types.js';

export const MACHINE_SIGNAL_SETTINGS_KEY = 'shared';
export const DEFAULT_NIGHT_START_MINUTE = 20 * 60;
export const MACHINE_SIGNAL_SENSOR_KINDS = ['MACHINE', 'ROBOT', 'LINE', 'OTHER'] as const;
export type MachineSignalSensorKind = (typeof MACHINE_SIGNAL_SENSOR_KINDS)[number];

export type MachineSignalSettingsDto = {
  /** 夜の開始（0時からの分）。昼は集計日の開始からここまで */
  nightStartMinute: number;
  thresholds: SignalThresholds;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type MachineSignalSensorDto = {
  signalNo: number;
  sourceMachineName: string;
  displayName: string | null;
  site: string | null;
  kind: MachineSignalSensorKind;
  hidden: boolean;
  plannedStartMinute: number | null;
  plannedEndMinute: number | null;
  runningKw: number | null;
  idleKw: number | null;
  categoryOverrides: SignalCategoryOverrides;
};

export type MachineSignalSensorUpdate = Omit<MachineSignalSensorDto, 'signalNo' | 'sourceMachineName'>;

/** 保存済みのしきい値に欠けや不正な値があっても、既定値で埋めて返す。 */
export function normalizeSignalThresholds(value: unknown): SignalThresholds {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const result = { ...DEFAULT_SIGNAL_THRESHOLDS };
  for (const key of Object.keys(result) as Array<keyof SignalThresholds>) {
    const candidate = source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) result[key] = candidate;
  }
  return result;
}

export function normalizeCategoryOverrides(value: unknown): SignalCategoryOverrides {
  if (!value || typeof value !== 'object') return {};
  const result: SignalCategoryOverrides = {};
  for (const [pattern, category] of Object.entries(value as Record<string, unknown>)) {
    if (/^[0124]{3}$/.test(pattern) && SIGNAL_CATEGORIES.includes(category as SignalCategory)) {
      result[pattern] = category as SignalCategory;
    }
  }
  return result;
}

export function toMachineSignalSensorDto(row: MachineSignalSensor): MachineSignalSensorDto {
  return {
    signalNo: row.signalNo,
    sourceMachineName: row.sourceMachineName,
    displayName: row.displayName,
    site: row.site,
    kind: MACHINE_SIGNAL_SENSOR_KINDS.includes(row.kind as MachineSignalSensorKind)
      ? (row.kind as MachineSignalSensorKind)
      : 'OTHER',
    hidden: row.hidden,
    plannedStartMinute: row.plannedStartMinute,
    plannedEndMinute: row.plannedEndMinute,
    runningKw: row.runningKw,
    idleKw: row.idleKw,
    categoryOverrides: normalizeCategoryOverrides(row.categoryOverrides),
  };
}

export async function getMachineSignalSettings(): Promise<MachineSignalSettingsDto> {
  const row = await prisma.machineSignalSettingsConfig.findUnique({ where: { key: MACHINE_SIGNAL_SETTINGS_KEY } });
  if (!row) {
    return {
      nightStartMinute: DEFAULT_NIGHT_START_MINUTE,
      thresholds: { ...DEFAULT_SIGNAL_THRESHOLDS },
      updatedAt: null,
      updatedBy: null,
    };
  }
  return {
    nightStartMinute: row.nightStartMinute,
    thresholds: normalizeSignalThresholds(row.thresholds),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export async function updateMachineSignalSettings(
  input: { nightStartMinute: number; thresholds: SignalThresholds },
  updatedBy: string | null
): Promise<MachineSignalSettingsDto> {
  if (input.thresholds.longStopMinSeconds <= input.thresholds.shortStopMaxSeconds) {
    throw new ApiError(400, '長い停止の下限は、短い停止の上限より長くしてください', undefined, 'MACHINE_SIGNAL_THRESHOLD_ORDER');
  }
  const data = {
    nightStartMinute: input.nightStartMinute,
    thresholds: input.thresholds as unknown as Prisma.InputJsonValue,
    updatedBy: updatedBy?.trim() || null,
  };
  await prisma.machineSignalSettingsConfig.upsert({
    where: { key: MACHINE_SIGNAL_SETTINGS_KEY },
    create: { key: MACHINE_SIGNAL_SETTINGS_KEY, ...data },
    update: data,
  });
  return getMachineSignalSettings();
}

export async function listMachineSignalSensors(): Promise<MachineSignalSensorDto[]> {
  const rows = await prisma.machineSignalSensor.findMany({ orderBy: { signalNo: 'asc' } });
  return rows.map(toMachineSignalSensorDto);
}

export async function updateMachineSignalSensor(
  signalNo: number,
  input: MachineSignalSensorUpdate
): Promise<MachineSignalSensorDto> {
  if ((input.plannedStartMinute === null) !== (input.plannedEndMinute === null)) {
    throw new ApiError(400, '稼働予定は開始と終了の両方を入れてください', undefined, 'MACHINE_SIGNAL_PLAN_INCOMPLETE');
  }
  const existing = await prisma.machineSignalSensor.findUnique({ where: { signalNo } });
  if (!existing) throw new ApiError(404, 'センサーが見つかりません', undefined, 'MACHINE_SIGNAL_SENSOR_NOT_FOUND');
  const row = await prisma.machineSignalSensor.update({
    where: { signalNo },
    data: {
      displayName: input.displayName?.trim() || null,
      site: input.site?.trim() || null,
      kind: input.kind,
      hidden: input.hidden,
      plannedStartMinute: input.plannedStartMinute,
      plannedEndMinute: input.plannedEndMinute,
      runningKw: input.runningKw,
      idleKw: input.idleKw,
      categoryOverrides: normalizeCategoryOverrides(input.categoryOverrides) as Prisma.InputJsonValue,
    },
  });
  return toMachineSignalSensorDto(row);
}
