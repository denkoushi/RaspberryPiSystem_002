import type { Prisma } from '@prisma/client';
import {
  ASSEMBLY_LOT_MAX_QUANTITY,
  buildAssemblyLotWorkIds
} from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeAssemblyUpperIdentifier } from './assembly-identifiers.js';
import { lockAssemblyLotProduct } from './assembly-lot-product-lock.js';
import { isAssemblyUniqueConstraintError } from './assembly-prisma-errors.js';
import { resolveAssemblyTraceabilityMode } from './assembly-template.service.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
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
    where: {
      workUnit: {
        invalidatedAt: null
      }
    },
    orderBy: { sortOrder: 'asc' },
    include: {
      workUnit: true,
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
  workIdMode?: 'auto' | 'manual';
  /** Legacy boundary name. New callers should use workIds. */
  serialNos?: string[];
  workIds?: string[];
  operatorEmployeeId?: string | null;
  operatorNameSnapshot?: string | null;
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

function normalizeWorkId(value: string): string {
  return required(normalizeAssemblyUpperIdentifier(value), '作業用ID').slice(0, 120);
}

function normalizeWorkIds(workIds: string[]): string[] {
  return workIds.map(normalizeWorkId);
}

function ensureUniqueWorkIds(workIds: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const workId of workIds) {
    if (seen.has(workId)) duplicates.add(workId);
    seen.add(workId);
  }
  if (duplicates.size > 0) {
    throw new ApiError(400, `作業用IDが重複しています: ${[...duplicates].slice(0, 5).join(', ')}`);
  }
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
      workUnitId: serial.workUnitId,
      sortOrder: serial.sortOrder,
      workId: serial.workUnit.workId,
      // 既存画面/API利用者向けの互換フィールド。新規画面は workId を使用する。
      serialNo: serial.workUnit.workId,
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
    isWorkComplete: serials.length > 0 && completedCount === serials.length,
    isFullyApproved: serials.length > 0 && approvedCount === serials.length,
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
    if (
      !Number.isInteger(input.expectedQuantity) ||
      expectedQuantity <= 0 ||
      expectedQuantity > ASSEMBLY_LOT_MAX_QUANTITY
    ) {
      throw new ApiError(400, `ロット数は1〜${ASSEMBLY_LOT_MAX_QUANTITY}の整数で指定してください`);
    }

    const productNo = required(normalizeAssemblyUpperIdentifier(input.productNo), '製番').slice(0, 120);
    const targetUnit = required(normalizeAssemblyUpperIdentifier(input.targetUnit), '機種名').slice(0, 120);
    const workIdMode = input.workIdMode ?? 'manual';
    let workIds: string[];
    if (workIdMode === 'auto') {
      if (input.workIds || input.serialNos) {
        throw new ApiError(400, '自動発行時は作業用IDを指定しないでください');
      }
      try {
        workIds = buildAssemblyLotWorkIds(productNo, expectedQuantity);
      } catch (error) {
        throw new ApiError(
          400,
          error instanceof Error ? error.message : '作業用IDを自動発行できません'
        );
      }
    } else {
      const requestedWorkIds = input.workIds ?? input.serialNos ?? [];
      if (requestedWorkIds.length !== expectedQuantity) {
        throw new ApiError(400, `作業用IDはロット数 ${expectedQuantity} 件ちょうど入力してください`);
      }
      workIds = normalizeWorkIds(requestedWorkIds);
    }
    ensureUniqueWorkIds(workIds);

    try {
      const lotId = await runAssemblyTransaction(async (tx) => {
        await lockAssemblyLotProduct(tx, productNo);
        const existingLot = await tx.assemblyLot.findFirst({
          where: { productNo },
          select: { id: true }
        });
        if (existingLot) {
          throw new ApiError(409, `製番 ${productNo} のロットは既に登録されています`);
        }
        const template = await tx.assemblyTemplate.findFirst({
          where: { id: input.templateId, isActive: true },
          select: { id: true, traceabilityMode: true }
        });
        if (!template) throw new ApiError(404, '有効な組立テンプレートが見つかりません');
        const torqueWrenchId =
          resolveAssemblyTraceabilityMode(template.traceabilityMode) === 'LEGACY'
            ? required(input.torqueWrenchId ?? '', '使用トルクレンチ').slice(0, 120)
            : '';

        const existingWorkUnits = await tx.assemblyWorkUnit.findMany({
          where: { workId: { in: workIds } },
          select: { workId: true },
          take: 5
        });
        if (existingWorkUnits.length > 0) {
          throw new ApiError(409, `登録済みの作業用IDがあります: ${existingWorkUnits.map((item) => item.workId).join(', ')}`);
        }

        const lot = await tx.assemblyLot.create({
          data: {
            templateId: template.id,
            productNo,
            expectedQuantity,
            operatorEmployeeId: input.operatorEmployeeId?.trim() || null,
            operatorNameSnapshot: input.operatorNameSnapshot?.trim().slice(0, 120) || null,
            targetUnit,
            torqueWrenchId,
            clientDeviceId: input.clientDeviceId ?? null,
            clientDeviceNameSnapshot: input.clientDeviceNameSnapshot ?? null
          },
          select: { id: true }
        });

        for (const [index, workId] of workIds.entries()) {
          const workUnit = await tx.assemblyWorkUnit.create({ data: { workId } });
          await tx.assemblyLotSerial.create({
            data: {
              lotId: lot.id,
              workUnitId: workUnit.id,
              sortOrder: index
            }
          });
        }

        return lot.id;
      });
      return this.getRequired(lotId);
    } catch (error) {
      if (isAssemblyUniqueConstraintError(error)) throw new ApiError(409, '登録済みの作業用IDがあります');
      throw error;
    }
  }

  async listSummary(params: { productNo?: string; limit?: number } = {}): Promise<AssemblyLotSummary[]> {
    const productNo = params.productNo ? normalizeAssemblyUpperIdentifier(params.productNo) : '';
    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 30), 1), 100);
    const lots = await prisma.assemblyLot.findMany({
      where: {
        ...(productNo ? { productNo: { equals: productNo, mode: 'insensitive' } } : {}),
        serials: {
          some: {
            workUnit: {
              invalidatedAt: null
            }
          }
        }
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
    operatorNfcTagUid: string;
    requestId: string;
    clientDeviceId?: string | null;
    clientDeviceNameSnapshot?: string | null;
  }) {
    return this.workSessionService.startRegisteredSerial(input);
  }
}
