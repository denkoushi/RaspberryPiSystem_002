import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getGrindingPlanningBoard,
  updateGrindingPlanningBoardOverrides,
  updateGrindingPlanningBoardRank,
  updateGrindingPlanningBoardResourceOrder,
  updateGrindingPlanningBoardSeibanOrder
} from '../../../services/production-schedule/grinding-planning-board.service.js';
import {
  getGrindingPlanningBoardDueScope,
  updateGrindingPlanningBoardDueScope
} from '../../../services/production-schedule/grinding-planning-board-due-scope.service.js';
import type { KioskRouteDeps } from './shared.js';

const querySchema = z.object({
  view: z.enum(['seiban', 'resource']).default('seiban'),
  category: z.enum(['grinding', 'cutting']).default('grinding'),
  fseibans: z.string().max(4000).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  snapshotId: z.string().min(1).max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(160).optional(),
  completionFilter: z.enum(['all', 'complete', 'incomplete']).default('all')
}).superRefine((value, context) => {
  if (value.snapshotId && value.cursor == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cursor'], message: 'snapshotId 指定時は cursor が必要です' });
  }
  if (value.cursor != null && value.cursor > 0 && !value.snapshotId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshotId'], message: '続きの cursor には snapshotId が必要です' });
  }
});

const sourceRevisionSchema = z.string().min(1).max(256);

const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: z.string() }),
  z.object({ kind: z.literal('offsetDays'), days: z.number().int() }),
  z.object({ kind: z.literal('restore') })
]);

const overridesBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  items: z.array(z.object({
    itemId: z.string().min(1).max(2_000),
    itemRevision: z.string().min(1).max(200),
    overrideVersion: z.number().int().min(0).optional(),
    resourceCd: z.string().max(20).nullable().optional(),
    due: dueSchema.optional()
  })).min(1).max(2_000)
});

const rankBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  itemId: z.string().min(1).max(2_000),
  itemRevision: z.string().min(1).max(200),
  overrideVersion: z.number().int().min(0).optional(),
  alternateRank: z.number().int().min(1).max(2_147_483_647).nullable()
});

const resourceOrderBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  itemId: z.string().min(1).max(2_000),
  itemRevision: z.string().min(1).max(200),
  overrideVersion: z.number().int().min(0).optional(),
  targetItemId: z.string().min(1).max(2_000),
  targetItemRevision: z.string().min(1).max(200),
  targetOverrideVersion: z.number().int().min(0).optional(),
  placement: z.enum(['before', 'after'])
});

const orderBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  fseibans: z.array(z.string().min(1).max(100)).max(50)
});

const dueScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seiban') }),
  z.object({ kind: z.literal('processing'), processingType: z.string().min(1).max(20) })
]);

const dueScopeRequestSchema = z.object({
  // The shell generation token contains the serialized read context and can
  // exceed the short sourceRevision limit used by the rank endpoints.
  sourceGenerationToken: z.string().min(1).max(16_384),
  scopeRevision: z.string().regex(/^[0-9a-f]{64}$/),
  scope: dueScopeSchema,
  dueDate: z.string().max(20)
});

const seibanParamSchema = z.object({
  fseiban: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(20))
});

function parseFseibans(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
}

export async function registerProductionScheduleGrindingPlanningBoardRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/grinding-planning-board', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const query = querySchema.parse(request.query);
    return getGrindingPlanningBoard({
      siteKey: scope.siteKey,
      category: query.category,
      view: query.view,
      fseibans: parseFseibans(query.fseibans),
      cursor: query.cursor,
      snapshotId: query.snapshotId,
      pageSize: query.pageSize,
      completionFilter: query.completionFilter,
      snapshotStore: deps.leaderboardShellSnapshotStore
    });
  });

  app.get('/kiosk/production-schedule/grinding-planning-board/seiban/:fseiban/due-detail', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const params = seibanParamSchema.parse(request.params);
    return getGrindingPlanningBoardDueScope({ siteKey: scope.siteKey, deviceScopeKey: scope.deviceScopeKey, fseiban: params.fseiban });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/seiban/:fseiban/due-scope', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const params = seibanParamSchema.parse(request.params);
    const body = dueScopeRequestSchema.parse(request.body);
    return updateGrindingPlanningBoardDueScope({ siteKey: scope.siteKey, fseiban: params.fseiban, request: body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/overrides', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = overridesBodySchema.parse(request.body);
    return updateGrindingPlanningBoardOverrides({ siteKey: scope.siteKey, ...body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/rank', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = rankBodySchema.parse(request.body);
    return updateGrindingPlanningBoardRank({ siteKey: scope.siteKey, ...body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourceOrderBodySchema.parse(request.body);
    return updateGrindingPlanningBoardResourceOrder({ siteKey: scope.siteKey, ...body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/seiban-order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = orderBodySchema.parse(request.body);
    return updateGrindingPlanningBoardSeibanOrder({ siteKey: scope.siteKey, ...body });
  });
}
