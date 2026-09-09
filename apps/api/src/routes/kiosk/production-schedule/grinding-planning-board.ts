import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getGrindingPlanningBoard,
  updateGrindingPlanningBoardOverrides,
  updateGrindingPlanningBoardRank,
  updateGrindingPlanningBoardSeibanOrder
} from '../../../services/production-schedule/grinding-planning-board.service.js';
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
  alternateRank: z.number().int().nullable()
});

const orderBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  fseibans: z.array(z.string().min(1).max(100)).max(50)
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

  app.put('/kiosk/production-schedule/grinding-planning-board/seiban-order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = orderBodySchema.parse(request.body);
    return updateGrindingPlanningBoardSeibanOrder({ siteKey: scope.siteKey, ...body });
  });
}
