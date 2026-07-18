import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeAssemblyUpperIdentifier } from './assembly-identifiers.js';
import { AssemblyWorkSessionService } from './assembly-work-session.service.js';

const assemblyLotInclude = {
  template: {
    select: {
      id: true,
      modelCode: true,
      procedurePattern: true,
      name: true,
      version: true
    }
  },
  serials: {
    orderBy: { sortOrder: 'asc' },
    include: {
      serialRegistry: true,
      workSession: {
        include: {
          approval: true
        }
      }
    }
  }
} satisfies Prisma.AssemblyLotInclude;

export type AssemblyLotDetail = Prisma.AssemblyLotGetPayload<{
  include: typeof assemblyLotInclude;
}>;

export type AssemblyLotSummary = ReturnType<typeof buildAssemblyLotSummary>;

export type AssemblyLotCreateInput = {
  templateId: string;
  productNo: string;
  expectedQuantity: number;
  serialNos: string[];
  operatorEmployeeId?: string | null;
  operatorNameSnapshot: string;
  targetUnit: string;
  torqueWrenchId?: string | null;
  clientDeviceId?: string | null;
  clientDeviceNameSnapshot?: string | null;
};

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError(400, `${label}が必要です`);
  return trimmed;
}

function normalizeSerialNo(value: string): string {
  return required(normalizeAssemblyUpperIdentifier(value), 'シリアルNo.').slice(0, 120);
}

function normalizeSerialNos(serialNos: string[]): string[] {
  return serialNos.map(normalizeSerialNo);
}

function ensureUniqueSerials(serialNos: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const serialNo of serialNos) {
    if (seen.has(serialNo)) duplicates.add(serialNo);
    seen.add(serialNo);
  }
  if (duplicates.size > 0) {
    throw new ApiError(400, `シリアルNo.が重複しています: ${[...duplicates].slice(0, 5).join(', ')}`);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function lotSerialStatus(serial: AssemblyLotDetail['serials'][number]) {
  if (!serial.workSession) return 'NOT_STARTED' as const;
  return serial.workSession.status;
}

export function buildAssemblyLotSummary(lot: AssemblyLotDetail) {
  const serials = lot.serials.map((serial) => {
    const status = lotSerialStatus(serial);
    return {
      id: serial.id,
      lotId: serial.lotId,
      sortOrder: serial.sortOrder,
      serialNo: serial.serialRegistry.serialNo,
      status,
      workSessionId: serial.workSession?.id ?? null,
      startedAt: serial.workSession?.startedAt ?? null,
      completedAt: serial.workSession?.completedAt ?? null,
      cancelledAt: serial.workSession?.cancelledAt ?? null,
      updatedAt: serial.workSession?.updatedAt ?? serial.updatedAt,
      approval: serial.workSession?.approval ?? null
    };
  });
  const completedCount = serials.filter((serial) => serial.status === 'COMPLETED').length;
  const approvedCount = serials.filter((serial) => serial.status === 'COMPLETED' && serial.approval != null).length;
  return {
    id: lot.id,
    templateId: lot.templateId,
    productNo: lot.productNo,
    expectedQuantity: lot.expectedQuantity,
    registeredSerialCount: lot.serials.length,
    notStartedCount: serials.filter((serial) => serial.status === 'NOT_STARTED').length,
    inProgressCount: serials.filter((serial) => serial.status === 'IN_PROGRESS').length,
    completedCount,
    cancelledCount: serials.filter((serial) => serial.status === 'CANCELLED').length,
    approvedCount,
    isWorkComplete: lot.serials.length === lot.expectedQuantity && completedCount === lot.expectedQuantity,
    isFullyApproved: lot.serials.length === lot.expectedQuantity && approvedCount === lot.expectedQuantity,
    operatorEmployeeId: lot.operatorEmployeeId,
    operatorNameSnapshot: lot.operatorNameSnapshot,
    targetUnit: lot.targetUnit,
    torqueWrenchId: lot.torqueWrenchId,
    clientDeviceId: lot.clientDeviceId,
    clientDeviceNameSnapshot: lot.clientDeviceNameSnapshot,
    createdAt: lot.createdAt,
    updatedAt: lot.updatedAt,
    template: lot.template,
    serials
  };
}

export class AssemblyLotService {
  constructor(private readonly workSessionService = new AssemblyWorkSessionService()) {}

  async create(input: AssemblyLotCreateInput): Promise<AssemblyLotDetail> {
    const expectedQuantity = Math.trunc(input.expectedQuantity);
    if (!Number.isInteger(input.expectedQuantity) || expectedQuantity <= 0) {
      throw new ApiError(400, 'ロット数は正の整数で指定してください');
    }
    if (input.serialNos.length !== expectedQuantity) {
      throw new ApiError(400, `シリアルNo.はロット数 ${expectedQuantity} 件ちょうど入力してください`);
    }

    const productNo = required(normalizeAssemblyUpperIdentifier(input.productNo), '製番').slice(0, 120);
    const targetUnit = required(normalizeAssemblyUpperIdentifier(input.targetUnit), '機種名').slice(0, 120);
    const serialNos = normalizeSerialNos(input.serialNos);
    ensureUniqueSerials(serialNos);

    const operatorNameSnapshot = required(input.operatorNameSnapshot, '作業者名').slice(0, 120);
    try {
      const lotId = await prisma.$transaction(async (tx) => {
        const template = await tx.assemblyTemplate.findFirst({
          where: { id: input.templateId, isActive: true },
          select: { id: true, traceabilityMode: true }
        });
        if (!template) throw new ApiError(404, '有効な組立テンプレートが見つかりません');
        const torqueWrenchId =
          template.traceabilityMode === 'LEGACY'
            ? required(input.torqueWrenchId ?? '', '使用トルクレンチ').slice(0, 120)
            : '';

        const existingSerials = await tx.assemblySerialRegistry.findMany({
          where: { serialNo: { in: serialNos } },
          select: { serialNo: true },
          take: 5
        });
        if (existingSerials.length > 0) {
          throw new ApiError(409, `登録済みのシリアルNo.があります: ${existingSerials.map((item) => item.serialNo).join(', ')}`);
        }

        const lot = await tx.assemblyLot.create({
          data: {
            templateId: template.id,
            productNo,
            expectedQuantity,
            operatorEmployeeId: input.operatorEmployeeId?.trim() || null,
            operatorNameSnapshot,
            targetUnit,
            torqueWrenchId,
            clientDeviceId: input.clientDeviceId ?? null,
            clientDeviceNameSnapshot: input.clientDeviceNameSnapshot ?? null
          },
          select: { id: true }
        });

        for (const [index, serialNo] of serialNos.entries()) {
          const registry = await tx.assemblySerialRegistry.create({ data: { serialNo } });
          await tx.assemblyLotSerial.create({
            data: {
              lotId: lot.id,
              serialRegistryId: registry.id,
              sortOrder: index
            }
          });
        }

        return lot.id;
      });
      return this.getRequired(lotId);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, '登録済みのシリアルNo.があります');
      throw error;
    }
  }

  async listSummary(params: { productNo?: string; limit?: number } = {}): Promise<AssemblyLotSummary[]> {
    const productNo = params.productNo ? normalizeAssemblyUpperIdentifier(params.productNo) : '';
    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 30), 1), 100);
    const lots = await prisma.assemblyLot.findMany({
      where: {
        ...(productNo ? { productNo: { equals: productNo, mode: 'insensitive' } } : {})
      },
      include: assemblyLotInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });
    return lots.map(buildAssemblyLotSummary);
  }

  async getById(id: string): Promise<AssemblyLotDetail | null> {
    return prisma.assemblyLot.findUnique({
      where: { id },
      include: assemblyLotInclude
    });
  }

  async getRequired(id: string): Promise<AssemblyLotDetail> {
    const lot = await this.getById(id);
    if (!lot) throw new ApiError(404, '組立ロットが見つかりません');
    return lot;
  }

  async getSummary(id: string): Promise<AssemblyLotSummary | null> {
    const lot = await this.getById(id);
    return lot ? buildAssemblyLotSummary(lot) : null;
  }

  async startSerial(input: {
    lotId: string;
    lotSerialId: string;
    clientDeviceId?: string | null;
    clientDeviceNameSnapshot?: string | null;
  }) {
    return this.workSessionService.startRegisteredSerial(input);
  }
}
