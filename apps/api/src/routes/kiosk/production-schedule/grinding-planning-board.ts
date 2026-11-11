import { createPlanningTestBar, mutatePlanningTestBar } from '../../../services/production-schedule/grinding-planning-board/test-bars.js';
import { grindingPlanningBoardDueSourceSchema } from '../../../services/production-schedule/grinding-planning-board/shared.js';
import { readScheduleSourceExcludedFseibans } from '../../../services/production-schedule/grinding-planning-board/schedule-source.js';
import { getGrindingPlanningBoardResourceMinutes, updateGrindingPlanningBoardResourceMinutesSource, updateGrindingPlanningBoardResourcePartMinutes, resourceMinutesSourceSchema, resourcePartMinutesSchema } from '../../../services/production-schedule/grinding-planning-board-resource-minutes.service.js';
import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { GrindingPlanningBoardProcessChipsRequest, GrindingPlanningBoardProcessChipsResponse } from '@raspi-system/shared-types';

import { buildLeaderboardPartFooterChipLookupKey } from '../../../services/production-schedule/leaderboard/leaderboard-part-footer-chip-key.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from '../../../services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.js';

import {
  getGrindingPlanningBoard,
  getGrindingPlanningBoardLoad,
  scheduleGrindingPlanningBoardRewarm,
  updateGrindingPlanningBoardArrival,
  updateGrindingPlanningBoardFirstProcessArrival,
  updateGrindingPlanningBoardOverrides,
  updateGrindingPlanningBoardPins,
  updateGrindingPlanningBoardRank,
  updateGrindingPlanningBoardResourceOrder,
  updateGrindingPlanningBoardResourceOrderBulk,
  updateGrindingPlanningBoardSeibanOrder,
  updateGrindingPlanningBoardSeibanChecks
} from '../../../services/production-schedule/grinding-planning-board.service.js';
import {
  getGrindingPlanningBoardDueScope,
  updateGrindingPlanningBoardDueScope
} from '../../../services/production-schedule/grinding-planning-board-due-scope.service.js';
import {
  resourceCapacityBodySchema,
  getGrindingPlanningBoardResourceCapacity,
  updateGrindingPlanningBoardResourceCapacity
} from '../../../services/production-schedule/grinding-planning-board-resource-capacity.service.js';
import { grindingPlanningBoardCategorySchema, type KioskRouteDeps } from './shared.js';

const scheduleSourceSchema = z.enum(['general', 'dCompany', 'both']).default('both');

const querySchema = z.object({
  scheduleSource: scheduleSourceSchema,
  dueSource: grindingPlanningBoardDueSourceSchema,
  view: z.enum(['seiban', 'resource']).default('seiban'),
  category: grindingPlanningBoardCategorySchema,
  includePieces: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  includeLoad: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  fseibans: z.string().max(4000).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  snapshotId: z.string().min(1).max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(640).optional(),
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

const processChipsBodySchema: z.ZodType<GrindingPlanningBoardProcessChipsRequest> = z.object({
  parts: z.array(z.object({
    fseiban: z.string().trim().min(1).max(100),
    productNo: z.string().trim().max(100),
    fhincd: z.string().trim().min(1).max(100)
  })).max(1000)
});

const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: z.string() }),
  z.object({ kind: z.literal('offsetDays'), days: z.number().int() }),
  z.object({ kind: z.literal('restore') })
]);

const specialDueSchema = z.enum(['today', 'overnight']);

const overridesBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  sourceRevision: sourceRevisionSchema,
  items: z.array(z.object({
    itemId: z.string().min(1).max(2_000),
    itemRevision: z.string().min(1).max(200),
    overrideVersion: z.number().int().min(0).optional(),
    resourceCd: z.string().max(20).nullable().optional(),
    due: dueSchema.optional(),
    specialDue: specialDueSchema.nullable().optional()
  })).min(1).max(2_000)
});

const arrivalBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  itemId: z.string().min(1).max(1000),
  itemRevision: z.string().min(1).max(200),
  overrideVersion: z.number().int().min(0).optional()
});

const pinsBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  sourceRevision: sourceRevisionSchema,
  items: z.array(z.object({
    itemId: z.string().min(1).max(2_000),
    itemRevision: z.string().min(1).max(200),
    overrideVersion: z.number().int().min(0).optional()
  })).min(1).max(2_000),
  pinned: z.boolean()
});

const rankBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  sourceRevision: sourceRevisionSchema,
  itemId: z.string().min(1).max(2_000),
  itemRevision: z.string().min(1).max(200),
  overrideVersion: z.number().int().min(0).optional(),
  alternateRank: z.number().int().min(1).max(2_147_483_647).nullable()
});

const resourceOrderBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  scheduleSource: scheduleSourceSchema,
  sourceRevision: sourceRevisionSchema,
  itemId: z.string().min(1).max(2_000),
  itemRevision: z.string().min(1).max(200),
  overrideVersion: z.number().int().min(0).optional(),
  targetItemId: z.string().min(1).max(2_000),
  targetItemRevision: z.string().min(1).max(200),
  targetOverrideVersion: z.number().int().min(0).optional(),
  placement: z.enum(['before', 'after'])
});

const resourceOrderBulkBodySchema = z.object({
  dueSource: grindingPlanningBoardDueSourceSchema,
  scheduleSource: scheduleSourceSchema,
  sourceRevision: sourceRevisionSchema,
  resourceCd: z.string().trim().min(1).max(20),
  items: z.array(z.object({
    itemId: z.string().min(1).max(2_000),
    itemRevision: z.string().min(1).max(200),
    overrideVersion: z.number().int().min(0).optional()
  })).min(1).max(500)
}).refine((value) => new Set(value.items.map((item) => item.itemId)).size === value.items.length, { message: 'アイテムIDが重複しています' });

const orderBodySchema = z.object({
  sourceRevision: sourceRevisionSchema,
  fseibans: z.array(z.string().min(1).max(100)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX)
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
  app.post('/kiosk/production-schedule/grinding-planning-board/process-chips', { config: { rateLimit: false } }, async (request): Promise<GrindingPlanningBoardProcessChipsResponse> => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const { parts } = processChipsBodySchema.parse(request.body);
    const { scheduleSource } = z.object({ scheduleSource: scheduleSourceSchema }).parse(request.query);
    if (parts.length === 0) return { chipsByPartKey: {} };
    const excluded = new Set(await readScheduleSourceExcludedFseibans(scheduleSource, [...new Set(parts.map((part) => part.fseiban))]));
    const uniqueParts = new Map(parts.filter((part) => !excluded.has(part.fseiban)).map((part) => [
      buildLeaderboardPartFooterChipLookupKey({ seibanJoinKey: part.fseiban, productNo: part.productNo, fhincd: part.fhincd }),
      part
    ]));
    if (uniqueParts.size === 0) return { chipsByPartKey: {} };
    const chipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [...uniqueParts].map(([id, part]) => ({
        id,
        seibanJoinKey: part.fseiban,
        rowData: { FSEIBAN: part.fseiban, ProductNo: part.productNo, FHINCD: part.fhincd }
      })),
      // These are part identities, not displayed CsvDashboardRow IDs.
      preferredDisplayRowIds: [],
      locationKey: scope.deviceScopeKey,
      siteKey: scope.siteKey
    });
    return { chipsByPartKey: chipsByPartKey ?? {} };
  });

  app.get('/kiosk/production-schedule/grinding-planning-board', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const query = querySchema.parse(request.query);
    return getGrindingPlanningBoard({
      scheduleSource: query.scheduleSource,
      dueSource: query.dueSource,
      siteKey: scope.siteKey,
      category: query.category,
      view: query.view,
      fseibans: parseFseibans(query.fseibans),
      cursor: query.cursor,
      snapshotId: query.snapshotId,
      pageSize: query.pageSize,
      completionFilter: query.completionFilter,
      includeLoad: query.includeLoad,
      ...(query.includePieces ? { includePieces: true } : {}),
      snapshotStore: deps.leaderboardShellSnapshotStore
    });
  });

  app.get('/kiosk/production-schedule/grinding-planning-board/resource-minutes', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    return getGrindingPlanningBoardResourceMinutes({ siteKey: scope.siteKey });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-minutes/source', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourceMinutesSourceSchema.parse(request.body);
    return updateGrindingPlanningBoardResourceMinutesSource({ siteKey: scope.siteKey, ...body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-minutes/value', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourcePartMinutesSchema.parse(request.body);
    return updateGrindingPlanningBoardResourcePartMinutes({ siteKey: scope.siteKey, ...body });
  });

  app.get('/kiosk/production-schedule/grinding-planning-board/resource-capacity', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    return getGrindingPlanningBoardResourceCapacity({ siteKey: scope.siteKey });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-capacity', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourceCapacityBodySchema.parse(request.body);
    return updateGrindingPlanningBoardResourceCapacity({ siteKey: scope.siteKey, ...body });
  });

  app.get('/kiosk/production-schedule/grinding-planning-board/load', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    // Older clients may send includePieces; load always includes pieces, so accept and ignore it.
    const query = z.object({ scheduleSource: scheduleSourceSchema, category: grindingPlanningBoardCategorySchema, includePieces: z.enum(['true', 'false']).optional().transform((value) => value === 'true') }).parse(request.query);
    return getGrindingPlanningBoardLoad({ siteKey: scope.siteKey, category: query.category, scheduleSource: query.scheduleSource });
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
    const result = await updateGrindingPlanningBoardDueScope({ siteKey: scope.siteKey, fseiban: params.fseiban, request: body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.post('/kiosk/production-schedule/grinding-planning-board/test-bars', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = z.object({ sourceRevision: sourceRevisionSchema, dueSource: grindingPlanningBoardDueSourceSchema,
      resourceCd: z.string().trim().min(1).max(20), minutes: z.number().int().min(5).max(1440),
      afterItem: z.object({ itemId: z.string().min(1).max(2000), itemRevision: z.string().min(1).max(200), overrideVersion: z.number().int().min(0).optional() }).optional()
    }).parse(request.body);
    const result = await createPlanningTestBar({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });
  for (const operation of [
    { method: 'DELETE', suffix: '', action: 'delete' },
    { method: 'POST', suffix: '/restore', action: 'restore' },
    { method: 'PUT', suffix: '/completion', action: 'completion' }
  ] as const) {
    app.route({ method: operation.method, url: `/kiosk/production-schedule/grinding-planning-board/test-bars/:id${operation.suffix}`,
      config: { rateLimit: false }, handler: async (request) => {
        const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
        const scope = deps.resolveLocationScopeContext(clientDevice);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z.object({ dueSource: grindingPlanningBoardDueSourceSchema, sourceRevision: sourceRevisionSchema, expectedVersion: z.number().int().min(1),
          intent: z.enum(['complete', 'incomplete']).optional() }).parse(request.body);
        const action = operation.action === 'completion' ? z.enum(['complete', 'incomplete']).parse(body.intent) : operation.action;
        const result = await mutatePlanningTestBar({ siteKey: scope.siteKey, id, ...body, action });
        void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
        return result;
      }
    });
  }

  app.put('/kiosk/production-schedule/grinding-planning-board/overrides', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = overridesBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardOverrides({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  for (const method of ['PUT', 'DELETE'] as const) {
    app.route({ method, url: '/kiosk/production-schedule/grinding-planning-board/arrival', config: { rateLimit: false },
      handler: async (request) => {
        const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
        const scope = deps.resolveLocationScopeContext(clientDevice);
        const body = arrivalBodySchema.parse(request.body);
        return updateGrindingPlanningBoardArrival({ siteKey: scope.siteKey, ...body, recorded: method === 'PUT' });
      }
    });
  }

  app.put('/kiosk/production-schedule/grinding-planning-board/first-process-arrival', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = arrivalBodySchema.extend({ state: z.enum(['arrived', 'excluded']).nullable() }).parse(request.body);
    return updateGrindingPlanningBoardFirstProcessArrival({ siteKey: scope.siteKey, ...body });
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/pins', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = pinsBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardPins({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/rank', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = rankBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardRank({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourceOrderBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardResourceOrder({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/resource-order/bulk', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = resourceOrderBulkBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardResourceOrderBulk({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/seiban-checks', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = z.object({ sourceRevision: sourceRevisionSchema,
      uncheckedFseibans: z.array(z.string().trim().min(1).max(100)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX)
    }).parse(request.body);
    const result = await updateGrindingPlanningBoardSeibanChecks({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });

  app.put('/kiosk/production-schedule/grinding-planning-board/seiban-order', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const body = orderBodySchema.parse(request.body);
    const result = await updateGrindingPlanningBoardSeibanOrder({ siteKey: scope.siteKey, ...body });
    void scheduleGrindingPlanningBoardRewarm({ siteKey: scope.siteKey, snapshotStore: deps.leaderboardShellSnapshotStore });
    return result;
  });
}
