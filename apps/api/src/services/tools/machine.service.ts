import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

export interface MachineQuery {
  search?: string;
  operatingStatus?: string;
}

export interface UninspectedMachineQuery {
  csvDashboardId: string;
  date?: string;
}

function formatTokyoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

function resolveTokyoDayRange(date?: string): { date: string; start: Date; end: Date } {
  const resolvedDate = date ?? formatTokyoDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
    throw new ApiError(400, 'dateはYYYY-MM-DD形式で指定してください');
  }
  const start = new Date(`${resolvedDate}T00:00:00+09:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { date: resolvedDate, start, end };
}

function extractEquipmentNumber(rowData: unknown): string | null {
  if (!rowData || typeof rowData !== 'object' || Array.isArray(rowData)) {
    return null;
  }
  const data = rowData as Record<string, unknown>;
  const normalized = data.equipmentManagementNumber;
  if (typeof normalized === 'string' && normalized.trim().length > 0) {
    return normalized.trim();
  }
  const rawJapanese = data['設備管理番号'];
  if (typeof rawJapanese === 'string' && rawJapanese.trim().length > 0) {
    return rawJapanese.trim();
  }
  return null;
}

export class MachineService {
  async findAll(query: MachineQuery) {
    const where: Prisma.MachineWhereInput = {
      ...(query.operatingStatus ? { operatingStatus: query.operatingStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shortName: { contains: query.search, mode: 'insensitive' } },
              { equipmentManagementNumber: { contains: query.search, mode: 'insensitive' } },
              { classification: { contains: query.search, mode: 'insensitive' } },
              { maker: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return prisma.machine.findMany({
      where,
      orderBy: [{ classification: 'asc' }, { equipmentManagementNumber: 'asc' }],
    });
  }

  async findUninspected(params: UninspectedMachineQuery) {
    const { csvDashboardId } = params;
    const { date, start, end } = resolveTokyoDayRange(params.date);

    const runningMachines = await prisma.machine.findMany({
      where: { operatingStatus: '稼働中' },
      orderBy: [{ classification: 'asc' }, { equipmentManagementNumber: 'asc' }],
    });

    const rows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId,
        occurredAt: {
          gte: start,
          lt: end,
        },
      },
      select: { rowData: true },
    });

    const inspectedEquipmentNumbers = new Set<string>();
    for (const row of rows) {
      const equipmentNumber = extractEquipmentNumber(row.rowData);
      if (equipmentNumber) {
        inspectedEquipmentNumbers.add(equipmentNumber);
      }
    }

    const uninspectedMachines = runningMachines.filter(
      (machine) => !inspectedEquipmentNumbers.has(machine.equipmentManagementNumber),
    );

    const inspectedRunningCount = runningMachines.length - uninspectedMachines.length;

    return {
      date,
      csvDashboardId,
      totalRunningMachines: runningMachines.length,
      inspectedRunningCount,
      uninspectedCount: uninspectedMachines.length,
      uninspectedMachines,
    };
  }
}
