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

export interface DailyInspectionMachineSummary {
  equipmentManagementNumber: string;
  name: string;
  shortName: string | null;
  classification: string | null;
  maker: string | null;
  processClassification: string | null;
  normalCount: number;
  abnormalCount: number;
  used: boolean;
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

function extractInspectionResult(rowData: unknown): string | null {
  if (!rowData || typeof rowData !== 'object' || Array.isArray(rowData)) {
    return null;
  }
  const data = rowData as Record<string, unknown>;
  const normalized = data.inspectionResult;
  if (typeof normalized === 'string' && normalized.trim().length > 0) {
    return normalized.trim();
  }
  const rawJapanese = data['点検結果'];
  if (typeof rawJapanese === 'string' && rawJapanese.trim().length > 0) {
    return rawJapanese.trim();
  }
  return null;
}

function classifyInspectionResult(result: string | null): 'normal' | 'abnormal' | null {
  if (!result) {
    return null;
  }
  if (result.includes('異常')) {
    return 'abnormal';
  }
  if (result.includes('正常')) {
    return 'normal';
  }
  // 正常/異常以外の値は見落とし防止のため異常扱いに寄せる。
  return 'abnormal';
}

export interface CreateMachinePayload {
  equipmentManagementNumber: string;
  name: string;
  shortName?: string;
  classification?: string;
  operatingStatus?: string;
  ncManual?: string;
  maker?: string;
  processClassification?: string;
  coolant?: string;
}

export interface UpdateMachinePayload {
  name?: string;
  shortName?: string;
  classification?: string;
  operatingStatus?: string;
  ncManual?: string;
  maker?: string;
  processClassification?: string;
  coolant?: string;
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

  async create(payload: CreateMachinePayload) {
    const existing = await prisma.machine.findUnique({
      where: { equipmentManagementNumber: payload.equipmentManagementNumber },
    });
    if (existing) {
      throw new ApiError(409, `設備管理番号 "${payload.equipmentManagementNumber}" は既に登録されています`);
    }

    return prisma.machine.create({
      data: {
        equipmentManagementNumber: payload.equipmentManagementNumber,
        name: payload.name,
        shortName: payload.shortName || null,
        classification: payload.classification || null,
        operatingStatus: payload.operatingStatus || null,
        ncManual: payload.ncManual || null,
        maker: payload.maker || null,
        processClassification: payload.processClassification || null,
        coolant: payload.coolant || null,
      },
    });
  }

  async update(id: string, payload: UpdateMachinePayload) {
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, '加工機が見つかりません');
    }

    return prisma.machine.update({
      where: { id },
      data: {
        name: payload.name ?? existing.name,
        shortName: payload.shortName !== undefined ? payload.shortName || null : existing.shortName,
        classification: payload.classification !== undefined ? payload.classification || null : existing.classification,
        operatingStatus: payload.operatingStatus !== undefined ? payload.operatingStatus || null : existing.operatingStatus,
        ncManual: payload.ncManual !== undefined ? payload.ncManual || null : existing.ncManual,
        maker: payload.maker !== undefined ? payload.maker || null : existing.maker,
        processClassification: payload.processClassification !== undefined ? payload.processClassification || null : existing.processClassification,
        coolant: payload.coolant !== undefined ? payload.coolant || null : existing.coolant,
      },
    });
  }

  async delete(id: string) {
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, '加工機が見つかりません');
    }

    await prisma.machine.delete({ where: { id } });
  }

  async findDailyInspectionSummaries(params: UninspectedMachineQuery) {
    const { csvDashboardId } = params;
    const { date, start, end } = resolveTokyoDayRange(params.date);

    const runningMachines = await prisma.machine.findMany({
      where: { operatingStatus: '稼働中' },
      orderBy: [{ classification: 'asc' }, { equipmentManagementNumber: 'asc' }],
    });

    const runningMachineNumbers = new Set(runningMachines.map((machine) => machine.equipmentManagementNumber));
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

    const aggregates = new Map<
      string,
      {
        normalCount: number;
        abnormalCount: number;
        used: boolean;
      }
    >();

    for (const row of rows) {
      const equipmentNumber = extractEquipmentNumber(row.rowData);
      if (!equipmentNumber || !runningMachineNumbers.has(equipmentNumber)) {
        continue;
      }

      const current = aggregates.get(equipmentNumber) ?? {
        normalCount: 0,
        abnormalCount: 0,
        used: false,
      };
      current.used = true;

      const category = classifyInspectionResult(extractInspectionResult(row.rowData));
      if (category === 'normal') {
        current.normalCount += 1;
      } else if (category === 'abnormal') {
        current.abnormalCount += 1;
      }

      aggregates.set(equipmentNumber, current);
    }

    const machines: DailyInspectionMachineSummary[] = runningMachines.map((machine) => {
      const aggregate = aggregates.get(machine.equipmentManagementNumber);
      return {
        equipmentManagementNumber: machine.equipmentManagementNumber,
        name: machine.name,
        shortName: machine.shortName,
        classification: machine.classification,
        maker: machine.maker,
        processClassification: machine.processClassification,
        normalCount: aggregate?.normalCount ?? 0,
        abnormalCount: aggregate?.abnormalCount ?? 0,
        used: aggregate?.used ?? false,
      };
    });

    const inspectedRunningCount = machines.filter((machine) => machine.used).length;
    const uninspectedCount = machines.length - inspectedRunningCount;

    return {
      date,
      csvDashboardId,
      totalRunningMachines: machines.length,
      inspectedRunningCount,
      uninspectedCount,
      machines,
    };
  }

  async findUninspected(params: UninspectedMachineQuery) {
    const result = await this.findDailyInspectionSummaries(params);
    const uninspectedMachines = result.machines
      .filter((machine) => !machine.used)
      .map((machine) => ({
        equipmentManagementNumber: machine.equipmentManagementNumber,
        name: machine.name,
        shortName: machine.shortName,
        classification: machine.classification,
        maker: machine.maker,
        processClassification: machine.processClassification,
      }));

    return {
      date: result.date,
      csvDashboardId: result.csvDashboardId,
      totalRunningMachines: result.totalRunningMachines,
      inspectedRunningCount: result.inspectedRunningCount,
      uninspectedCount: result.uninspectedCount,
      uninspectedMachines,
    };
  }
}
