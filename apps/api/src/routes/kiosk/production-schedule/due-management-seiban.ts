import type { FastifyInstance } from 'fastify';

import { listSeibanProcessingDueDates } from '../../../services/production-schedule/due-date-resolution.service.js';
import { getDueManagementSeibanDetailWithScope } from '../../../services/production-schedule/due-management-location-scope-adapter.service.js';
import { getProcessingTypePriority } from '../../../services/production-schedule/policies/processing-priority-policy.js';
import { productionScheduleDueManagementSeibanParamsSchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDueManagementSeibanRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/due-management/seiban/:fseiban', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const params = productionScheduleDueManagementSeibanParamsSchema.parse(request.params);
    const detail = await getDueManagementSeibanDetailWithScope({
      locationScope: locationScopeContext,
      fseiban: params.fseiban
    });
    const processingDueDateMap = await listSeibanProcessingDueDates(params.fseiban);
    const processingTypeDueDates = Array.from(
      new Set(
        detail.parts
          .map((part) => part.processingType?.trim() ?? '')
          .filter((processingType) => processingType.length > 0)
      )
    )
      .sort((a, b) => {
        const aPriority = getProcessingTypePriority(a);
        const bPriority = getProcessingTypePriority(b);
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.localeCompare(b);
      })
      .map((processingType) => ({
        processingType,
        dueDate: processingDueDateMap.get(processingType) ?? null
      }));

    return {
      detail: {
        ...detail,
        processingTypeDueDates,
        parts: detail.parts.map((part) => ({
          ...part,
          effectiveDueDate:
            part.processingType && processingDueDateMap.get(part.processingType)
              ? processingDueDateMap.get(part.processingType)
              : detail.dueDate
        }))
      }
    };
  });
}
