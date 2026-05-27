import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../../lib/errors.js';
import { getProductionScheduleLoadBalancingOverview } from '../../../services/production-schedule/load-balancing/load-balancing-overview.service.js';
import { getProductionScheduleMachineMonthlyLoad } from '../../../services/production-schedule/load-balancing/machine-monthly-load.service.js';
import { parseYearMonthRangeUtc } from '../../../services/production-schedule/load-balancing/monthly-load-query.service.js';
import {
  getProductionScheduleOutsourcingCandidates,
  getProductionScheduleOutsourcingPlan,
  getProductionScheduleOutsourcingReplacements,
  simulateProductionScheduleOutsourcing
} from '../../../services/production-schedule/load-balancing/outsourcing-simulation.service.js';
import { suggestProductionScheduleLoadBalancing } from '../../../services/production-schedule/load-balancing/reallocation-suggestion.service.js';
import {
  getProductionScheduleStartDateLeveling,
  simulateProductionScheduleStartDateLeveling
} from '../../../services/production-schedule/load-balancing/start-date-leveling.service.js';
import { LOAD_BALANCING_OUTSOURCING_LIMITS } from '../../../services/production-schedule/load-balancing/outsourcing-simulation.policy.js';
import { assertYearMonthFormat } from '../../../services/production-schedule/load-balancing/year-month-range.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';
import { toLegacyLocationKeyFromDeviceScope, type KioskRouteDeps } from './shared.js';

const {
  MAX_CANDIDATES_LIST_REQUEST,
  MAX_SELECTED_CANDIDATE_IDS,
  MAX_ROW_CANDIDATES_LIST,
  MAX_OVER_RESOURCE_CDS
} = LOAD_BALANCING_OUTSOURCING_LIMITS;

const overviewQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

const suggestionsBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  maxSuggestions: z.coerce.number().int().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(MAX_OVER_RESOURCE_CDS).optional()
});

const outsourcingCandidatesBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(MAX_OVER_RESOURCE_CDS).optional(),
  maxCandidates: z.coerce.number().int().min(1).max(MAX_CANDIDATES_LIST_REQUEST).optional()
});

const outsourcingSimulateBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(MAX_OVER_RESOURCE_CDS).optional(),
  selectedRowIds: z.array(z.string().min(1).max(80)).max(MAX_ROW_CANDIDATES_LIST).optional(),
  selectedCandidateIds: z.array(z.string().min(1).max(200)).max(MAX_SELECTED_CANDIDATE_IDS).optional()
});

const outsourcingPlanBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(MAX_OVER_RESOURCE_CDS).optional(),
  strategy: z.enum(['max_over_reduction']).optional()
});

const outsourcingReplacementsBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  overResourceCds: z.array(z.string().min(1).max(20)).max(MAX_OVER_RESOURCE_CDS).optional(),
  currentSelectedCandidateIds: z.array(z.string().min(1).max(200)).max(MAX_SELECTED_CANDIDATE_IDS),
  removeCandidateId: z.string().min(1).max(200),
  maxOptions: z.coerce.number().int().min(1).max(10).optional()
});

const machineMonthlyLoadQuerySchema = z.object({
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  machineName: z.string().min(1).max(200).optional(),
  fhincd: z.string().min(1).max(40).optional()
});

const startDateLevelingQuerySchema = z.object({
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
  bucket: z.enum(['month', 'day']).default('month'),
  focusMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  resourceCd: z.string().min(1).max(20).optional()
});

const startDateLevelingSimulateBodySchema = z.object({
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
  bucket: z.enum(['month', 'day']).default('month'),
  focusMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  resourceCd: z.string().min(1).max(20).optional(),
  moves: z
    .array(
      z.object({
        rowId: z.string().min(1).max(80),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      })
    )
    .max(200)
});

function assertValidYearMonth(month: string): void {
  try {
    parseYearMonthRangeUtc(month);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'month が不正です';
    throw new ApiError(400, message);
  }
}

function assertValidYearMonthRange(fromMonth: string, toMonth: string): void {
  try {
    assertYearMonthFormat(fromMonth);
    assertYearMonthFormat(toMonth);
  } catch (error) {
    const message = error instanceof Error ? error.message : '月の指定が不正です';
    throw new ApiError(400, message);
  }
}

export async function registerProductionScheduleLoadBalancingRoutes(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/load-balancing/overview', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const query = overviewQuerySchema.parse(request.query);

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      targetDeviceScopeKey: query.targetDeviceScopeKey
    });

    assertValidYearMonth(query.month);

    return getProductionScheduleLoadBalancingOverview({
      siteKey: resolvedSiteKey,
      deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
      yearMonth: query.month
    });
  });

  app.get(
    '/kiosk/production-schedule/load-balancing/machine-monthly-load',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const query = machineMonthlyLoadQuerySchema.parse(request.query);

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: query.targetDeviceScopeKey
      });

      assertValidYearMonthRange(query.fromMonth, query.toMonth);

      try {
        return await getProductionScheduleMachineMonthlyLoad({
          siteKeyInput: resolvedSiteKey,
          deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
          fromMonth: query.fromMonth,
          toMonth: query.toMonth,
          machineName: query.machineName,
          fhincd: query.fhincd
        });
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        if (error instanceof Error) {
          const recoverableMessages = ['以前である必要があります', '最大 ', 'YYYY-MM 形式'];
          if (recoverableMessages.some((snippet) => error.message.includes(snippet))) {
            throw new ApiError(400, error.message);
          }
        }
        throw error;
      }
    }
  );

  app.get(
    '/kiosk/production-schedule/load-balancing/start-date-leveling',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const query = startDateLevelingQuerySchema.parse(request.query);

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: query.targetDeviceScopeKey
      });

      assertValidYearMonthRange(query.fromMonth, query.toMonth);

      try {
        return await getProductionScheduleStartDateLeveling({
          siteKeyInput: resolvedSiteKey,
          deviceScopeKey: query.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
          fromMonth: query.fromMonth,
          toMonth: query.toMonth,
          bucket: query.bucket,
          focusMonth: query.focusMonth,
          resourceCdFilter: query.resourceCd
        });
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        if (error instanceof Error) {
          const recoverableMessages = ['以前である必要があります', '最大 ', 'YYYY-MM 形式', '稼働日ではありません'];
          if (recoverableMessages.some((snippet) => error.message.includes(snippet))) {
            throw new ApiError(400, error.message);
          }
        }
        throw error;
      }
    }
  );

  app.post(
    '/kiosk/production-schedule/load-balancing/start-date-leveling/simulate',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const body = startDateLevelingSimulateBodySchema.parse(request.body ?? {});

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: body.targetDeviceScopeKey
      });

      assertValidYearMonth(body.fromMonth);
      assertValidYearMonth(body.toMonth);

      try {
        return await simulateProductionScheduleStartDateLeveling({
          siteKeyInput: resolvedSiteKey,
          deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
          fromMonth: body.fromMonth,
          toMonth: body.toMonth,
          bucket: body.bucket,
          focusMonth: body.focusMonth,
          resourceCdFilter: body.resourceCd,
          moves: body.moves
        });
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        if (error instanceof Error) {
          const recoverableMessages = ['以前である必要があります', '最大 ', 'YYYY-MM 形式', '稼働日ではありません'];
          if (recoverableMessages.some((snippet) => error.message.includes(snippet))) {
            throw new ApiError(400, error.message);
          }
        }
        throw error;
      }
    }
  );

  app.post(
    '/kiosk/production-schedule/load-balancing/outsourcing-candidates',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const body = outsourcingCandidatesBodySchema.parse(request.body ?? {});

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: body.targetDeviceScopeKey
      });

      assertValidYearMonth(body.month);

      return getProductionScheduleOutsourcingCandidates({
        siteKey: resolvedSiteKey,
        deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        yearMonth: body.month,
        overResourceCds: body.overResourceCds,
        maxCandidates: body.maxCandidates ?? 100
      });
    }
  );

  app.post(
    '/kiosk/production-schedule/load-balancing/outsourcing-simulate',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const body = outsourcingSimulateBodySchema.parse(request.body ?? {});

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: body.targetDeviceScopeKey
      });

      assertValidYearMonth(body.month);

      return simulateProductionScheduleOutsourcing({
        siteKey: resolvedSiteKey,
        deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        yearMonth: body.month,
        overResourceCds: body.overResourceCds,
        selectedRowIds: body.selectedRowIds,
        selectedCandidateIds: body.selectedCandidateIds
      });
    }
  );

  app.post(
    '/kiosk/production-schedule/load-balancing/outsourcing-plan',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const body = outsourcingPlanBodySchema.parse(request.body ?? {});

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: body.targetDeviceScopeKey
      });

      assertValidYearMonth(body.month);

      return getProductionScheduleOutsourcingPlan({
        siteKey: resolvedSiteKey,
        deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        yearMonth: body.month,
        overResourceCds: body.overResourceCds,
        strategy: body.strategy
      });
    }
  );

  app.post(
    '/kiosk/production-schedule/load-balancing/outsourcing-replacements',
    { config: { rateLimit: false } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
      const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
      const body = outsourcingReplacementsBodySchema.parse(request.body ?? {});

      const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
        targetDeviceScopeKey: body.targetDeviceScopeKey
      });

      assertValidYearMonth(body.month);

      return getProductionScheduleOutsourcingReplacements({
        siteKey: resolvedSiteKey,
        deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
        yearMonth: body.month,
        overResourceCds: body.overResourceCds,
        currentSelectedCandidateIds: body.currentSelectedCandidateIds,
        removeCandidateId: body.removeCandidateId,
        maxOptions: body.maxOptions
      });
    }
  );

  app.post('/kiosk/production-schedule/load-balancing/suggestions', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorDeviceScopeKey = locationScopeContext.deviceScopeKey;
    const body = suggestionsBodySchema.parse(request.body ?? {});

    const resolvedSiteKey = await resolveProductionScheduleAssignmentLocationKey({
      actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(actorDeviceScopeKey),
      targetDeviceScopeKey: body.targetDeviceScopeKey
    });

    assertValidYearMonth(body.month);

    return suggestProductionScheduleLoadBalancing({
      siteKey: resolvedSiteKey,
      deviceScopeKey: body.targetDeviceScopeKey?.trim() || actorDeviceScopeKey,
      yearMonth: body.month,
      maxSuggestions: body.maxSuggestions ?? 25,
      overResourceCds: body.overResourceCds
    });
  });
}
