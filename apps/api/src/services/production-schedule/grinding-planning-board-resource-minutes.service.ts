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
  setupMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  minutes: z.number().finite().positive().max(100000)
});
export const resourceMinutesSourceSchema = z.object({
  resourceCd: resourceCdSchema,
  source: z.enum(['original', 'own'])
});
export const resourcePartMinutesExpectedSchema = z.object({
    perUnitMinutes: z.number().finite().min(0).max(100000),
    setupMinutes: z.number().int().min(0).max(100000),
    ops: z.array(resourcePartOpMinutesSchema.extend({ setupMinutes: z.number().int().min(0).max(100000).nullable() })).max(20)
      .refine((ops) => new Set(ops.map((op) => op.opNo)).size === ops.length)
  }).nullable();
export const resourcePartMinutesSchema = z.object({
  resourceCd: resourceCdSchema,
  fhincd: z.string().trim().min(1).max(120),
  perUnitMinutes: z.number().finite().min(0).max(100000).nullable(),
  setupMinutes: z.number().int().min(0).max(100000),
  expectedOpIds: z.array(z.string()).max(20).optional(),
  expectedMinutes: resourcePartMinutesExpectedSchema.optional(),
  ops: z.array(resourcePartOpMinutesSchema).max(20).optional()
}).refine((value) => !value.ops || new Set(value.ops.map((op) => op.opNo)).size === value.ops.length,
  { message: '工程番号が重複しています' })
  .refine((value) => !value.ops?.length || value.perUnitMinutes !== null, { message: '工程には品番の時間が必要です' })
  .refine((value) => (value.ops?.reduce((sum, op) => sum + op.minutes, 0) ?? 0) <= 100000,
    { message: '工程の合計時間は100000分以下で指定してください' });

type MinutesSnapshot = NonNullable<GrindingPlanningBoardResourcePartMinutesRequest['expectedMinutes']>;
function resolveOperations(
  ops: GrindingPlanningBoardResourcePartMinutesRequest['ops'],
  previousOps: MinutesSnapshot['ops'],
  setupMinutes: number
): MinutesSnapshot['ops'] {
  const nextOps = ops?.map((op) => ({
    ...op,
    setupMinutes: op.setupMinutes === undefined
      ? previousOps.find((previous) => previous.opNo === op.opNo)?.setupMinutes ?? null
      : op.setupMinutes
  })) ?? previousOps;
  if (ops?.length && !ops.some((op) => Object.prototype.hasOwnProperty.call(op, 'setupMinutes')) &&
    nextOps.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0) !== setupMinutes) {
    const first = Math.min(...nextOps.map((op) => op.opNo));
    nextOps.forEach((op) => { op.setupMinutes = op.opNo === first ? setupMinutes : null; });
  }
  return nextOps;
}

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
      where, select: { resourceCd: true, fhincd: true, perUnitMinutes: true, setupMinutes: true, ops: { select: { id: true, opNo: true, minutes: true, setupMinutes: true }, orderBy: { opNo: 'asc' } } },
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
  const { fhincd } = resourcePartMinutesSchema.parse(params);
  const result = await prisma.$transaction(async (tx) => {
    const keys = await lockOperationDefinitionPieces(tx, fhincd);
    return saveGrindingPlanningBoardResourcePartMinutes(tx, params, keys);
  }, { timeout: 30000, maxWait: 15000 });
  return { ...await getGrindingPlanningBoardResourceMinutes(params),
    savedOpIds: result.ops.map((op) => op.id), savedOpNos: result.ops.map((op) => op.opNo), savedMinutes: result.minutes };
}

/** Caller holds the definition's critical/logical/board/row locks before entering. */
export async function saveGrindingPlanningBoardResourcePartMinutes(
  tx: Prisma.TransactionClient,
  params: GrindingPlanningBoardResourcePartMinutesRequest & { siteKey: string },
  keys: Awaited<ReturnType<typeof lockOperationDefinitionPieces>>
) {
  const { resourceCd, fhincd, perUnitMinutes, setupMinutes, ops, expectedOpIds, expectedMinutes } = resourcePartMinutesSchema.parse(params);
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd, fhincd };
  if (expectedOpIds !== undefined || expectedMinutes !== undefined) {
    const current = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findUnique({
      where: { csvDashboardId_siteKey_resourceCd_fhincd: key }, include: { ops: true }
    });
    const ids = (values: string[]) => JSON.stringify([...new Set(values)].sort());
    const idsChanged = expectedOpIds !== undefined && ids(expectedOpIds) !== ids(current?.ops.map((op) => op.id) ?? []);
    const close = (left: number, right: number) => Math.abs(left - right) <= 1e-6;
    const matchesCurrent = (minutes: MinutesSnapshot | null) => minutes === null ? !current : current &&
      close(minutes.perUnitMinutes, current.perUnitMinutes) && close(minutes.setupMinutes, current.setupMinutes) &&
      minutes.ops.length === current.ops.length && minutes.ops.every((op) => {
        const saved = current.ops.find((entry) => entry.opNo === op.opNo);
        return saved && close(op.minutes, saved.minutes) &&
          (op.setupMinutes === null || saved.setupMinutes === null ? op.setupMinutes === saved.setupMinutes : close(op.setupMinutes, saved.setupMinutes));
      });
    const minutesChanged = expectedMinutes !== undefined && !matchesCurrent(expectedMinutes);
    if (idsChanged || minutesChanged) {
      const nextOps = resolveOperations(ops, current?.ops ?? [], setupMinutes);
      const operationMinutes = nextOps.reduce((sum, op) => sum + op.minutes, 0);
      const operationSetup = nextOps.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0);
      const legacyMatches = ops !== undefined || !nextOps.length ||
        (perUnitMinutes !== null && close(perUnitMinutes, operationMinutes) && setupMinutes === operationSetup);
      const intended = perUnitMinutes === null ? null : {
        perUnitMinutes: nextOps.length ? operationMinutes : perUnitMinutes,
        setupMinutes: nextOps.length ? operationSetup : setupMinutes,
        ops: nextOps
      };
      const identicalRetry = legacyMatches && matchesCurrent(intended);
      if (identicalRetry && ops !== undefined) {
        return { ops: [...(current?.ops ?? [])].sort((a, b) => a.opNo - b.opNo), minutes: current ? {
          perUnitMinutes: current.perUnitMinutes, setupMinutes: current.setupMinutes,
          ops: current.ops.map(({ opNo, minutes, setupMinutes }) => ({ opNo, minutes, setupMinutes }))
        } : null };
      }
      if (idsChanged) {
        throw new ApiError(409, '他の端末で工程が変わりました。表を開き直してください', undefined, 'OPERATION_SET_CHANGED');
      }
      if (!identicalRetry) {
        throw new ApiError(409, '他の端末で加工時間が変わりました。表を開き直してください', undefined, 'RESOURCE_MINUTES_CHANGED');
      }
    }
  }
  if (perUnitMinutes === null) {
    await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: key });
    await reconcileOperationDefinitionPieces(tx, { siteKey: params.siteKey, resourceCd }, keys, []);
    return { ops: [], minutes: null };
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
  const nextOps = resolveOperations(ops, saved.ops, setupMinutes);
  const operationSetup = nextOps.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0);
  if (operationSetup > 100000) {
    throw new ApiError(400, '工程の段取りの合計時間は100000分以下で指定してください');
  }
  if (ops === undefined && saved.ops.length && setupMinutes !== operationSetup) {
    throw new ApiError(400, '工程の段取りの合計時間と一致しません。工程表を更新してください', undefined, 'OPERATION_SETUP_MISMATCH');
  }
  if (ops !== undefined) {
    const removed = saved.ops.filter((previous) => !ops.some((op) => op.opNo === previous.opNo));
    if (removed.length) await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.deleteMany({
      where: { partMinutesId: saved.id, id: { in: removed.map((op) => op.id) } }
    });
    for (const op of nextOps) {
      const previous = saved.ops.find((entry) => entry.opNo === op.opNo);
      if (previous) await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.update({
        where: { id: previous.id }, data: { minutes: op.minutes, setupMinutes: op.setupMinutes }
      });
    }
    const added = nextOps.filter((op) => !saved.ops.some((previous) => previous.opNo === op.opNo));
    if (added.length) await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.createMany({
      data: added.map((op) => ({ ...op, partMinutesId: saved.id }))
    });
  }
  if (nextOps.length) await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update({
    where: { id: saved.id }, data: { perUnitMinutes: nextOps.reduce((sum, op) => sum + op.minutes, 0), setupMinutes: operationSetup }
  });
  // Minute-only edits keep the same operation set, so completion records and piece-set versions stay untouched.
  const sameOpNos = (left: readonly { opNo: number }[], right: readonly { opNo: number }[]) =>
    left.map((op) => op.opNo).sort((x, y) => x - y).join(',') === right.map((op) => op.opNo).sort((x, y) => x - y).join(',');
  if (ops !== undefined && !sameOpNos(saved.ops, ops)) {
    await reconcileOperationDefinitionPieces(tx, { siteKey: params.siteKey, resourceCd }, keys, nextOps.map((op) => op.opNo));
  }
  const savedOps = await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany({
    where: { partMinutesId: saved.id }, select: { id: true, opNo: true }, orderBy: { opNo: 'asc' }
  });
  return { ops: savedOps, minutes: {
    perUnitMinutes: nextOps.length ? nextOps.reduce((sum, op) => sum + op.minutes, 0) : perUnitMinutes,
    setupMinutes: nextOps.length ? operationSetup : setupMinutes,
    ops: nextOps.map((op) => ({ opNo: op.opNo, minutes: op.minutes, setupMinutes: op.setupMinutes }))
  } };
}
