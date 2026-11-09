import { lockOperationDefinitionPieces, reconcileOperationDefinitionPieces } from './sessaku-pieces/piece-operation-definitions.js';
import type { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardResourceMinutesSourceRequest,
  GrindingPlanningBoardResourcePartMinutesRequest
} from '@raspi-system/shared-types';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { resourceCdSchema } from './grinding-planning-board-resource-capacity.service.js';

// MachinePalletItem already stores production-schedule FHINCD in VARCHAR(120).
export const resourcePartOpMinutesSchema = z.object({
  opNo: z.number().int().min(1).max(20),
  minutes: z.number().finite().positive().max(100000)
});
export const resourceMinutesSourceSchema = z.object({
  resourceCd: resourceCdSchema,
  source: z.enum(['original', 'own'])
});
export const resourcePartMinutesSchema = z.object({
  resourceCd: resourceCdSchema,
  fhincd: z.string().trim().min(1).max(120),
  perUnitMinutes: z.number().finite().min(0).max(100000).nullable(),
  setupMinutes: z.number().int().min(0).max(100000),
  ops: z.array(resourcePartOpMinutesSchema).max(20).optional()
}).refine((value) => !value.ops || new Set(value.ops.map((op) => op.opNo)).size === value.ops.length,
  { message: '工程番号が重複しています' })
  .refine((value) => !value.ops?.length || value.perUnitMinutes !== null, { message: '工程には品番の時間が必要です' })
  .refine((value) => (value.ops?.reduce((sum, op) => sum + op.minutes, 0) ?? 0) <= 100000,
    { message: '工程の合計時間は100000分以下で指定してください' });

type MinutesClient = Pick<Prisma.TransactionClient,
  'productionScheduleGrindingPlanningBoardResourceMinutesSource' | 'productionScheduleGrindingPlanningBoardResourcePartMinutes'>;

export async function getGrindingPlanningBoardResourceMinutes(
  params: { siteKey: string }, client: MinutesClient = prisma
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const where = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey };
  const [sources, values] = await Promise.all([
    client.productionScheduleGrindingPlanningBoardResourceMinutesSource.findMany({
      where, select: { resourceCd: true }, orderBy: { resourceCd: 'asc' }
    }),
    client.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany({
      where, select: { resourceCd: true, fhincd: true, perUnitMinutes: true, setupMinutes: true, ops: { select: { opNo: true, minutes: true }, orderBy: { opNo: 'asc' } } },
      orderBy: [{ resourceCd: 'asc' }, { fhincd: 'asc' }]
    })
  ]);
  return { ownSourceResourceCds: sources.map((row) => row.resourceCd), values };
}

export async function updateGrindingPlanningBoardResourceMinutesSource(
  params: GrindingPlanningBoardResourceMinutesSourceRequest & { siteKey: string }
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const { resourceCd, source } = resourceMinutesSourceSchema.parse(params);
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd };
  if (source === 'original') {
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: key });
  } else {
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.upsert({
      where: { csvDashboardId_siteKey_resourceCd: key }, create: { ...key, source }, update: { source }
    });
  }
  return getGrindingPlanningBoardResourceMinutes(params);
}

export async function updateGrindingPlanningBoardResourcePartMinutes(
  params: GrindingPlanningBoardResourcePartMinutesRequest & { siteKey: string }
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const { resourceCd, fhincd, perUnitMinutes, setupMinutes, ops } = resourcePartMinutesSchema.parse(params);
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd, fhincd };
  await prisma.$transaction(async (tx) => {
    const keys = ops !== undefined || perUnitMinutes === null ? await lockOperationDefinitionPieces(tx, fhincd) : [];
    if (perUnitMinutes === null) {
      await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: key });
      await reconcileOperationDefinitionPieces(tx, { siteKey: params.siteKey, resourceCd }, keys, []);
      return;
    }
    // An omitted ops field preserves registered operations for existing clients.
    const saved = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert({
      where: { csvDashboardId_siteKey_resourceCd_fhincd: key },
      create: { ...key, perUnitMinutes, setupMinutes }, update: { perUnitMinutes, setupMinutes },
      include: { ops: true }
    });
    if (ops === undefined && saved.ops.length && Math.abs(perUnitMinutes - saved.ops.reduce((sum, op) => sum + op.minutes, 0)) > 1e-6) {
      throw new ApiError(400, '工程の合計時間と一致しません。工程表を更新してください', undefined, 'OPERATION_MINUTES_MISMATCH');
    }
    const nextOps = ops ?? saved.ops;
    if (ops !== undefined) {
      await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.deleteMany({ where: { partMinutesId: saved.id } });
      if (ops.length) await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.createMany({
        data: ops.map((op) => ({ ...op, partMinutesId: saved.id }))
      });
    }
    if (nextOps.length) await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update({
      where: { id: saved.id }, data: { perUnitMinutes: nextOps.reduce((sum, op) => sum + op.minutes, 0) }
    });
    // Minute-only edits keep the same operation set, so completion records and piece-set versions stay untouched.
    const sameOpNos = (left: readonly { opNo: number }[], right: readonly { opNo: number }[]) =>
      left.map((op) => op.opNo).sort((x, y) => x - y).join(',') === right.map((op) => op.opNo).sort((x, y) => x - y).join(',');
    if (ops !== undefined && !sameOpNos(saved.ops, ops)) {
      await reconcileOperationDefinitionPieces(tx, { siteKey: params.siteKey, resourceCd }, keys, nextOps.map((op) => op.opNo));
    }
  }, { timeout: 30000, maxWait: 15000 });
  return getGrindingPlanningBoardResourceMinutes(params);
}
