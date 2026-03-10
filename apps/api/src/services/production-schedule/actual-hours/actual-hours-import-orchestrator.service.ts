import { ProductionActualHoursAggregateService } from '../production-actual-hours-aggregate.service.js';
import { ProductionActualHoursImportService } from '../production-actual-hours-import.service.js';
import { ActualHoursCanonicalResolverService } from './actual-hours-canonical-resolver.service.js';

export class ActualHoursImportOrchestratorService {
  constructor(
    private readonly importService = new ProductionActualHoursImportService(),
    private readonly canonicalResolver = new ActualHoursCanonicalResolverService(),
    private readonly aggregateService = new ProductionActualHoursAggregateService()
  ) {}

  async importFromCsv(params: {
    buffer: Buffer;
    sourceFileKey: string;
    locationKey: string;
    sourceScheduleId?: string;
    sourceMessageId?: string;
    csvDashboardId?: string;
  }) {
    const importResult = await this.importService.importFromCsv({
      buffer: params.buffer,
      sourceFileKey: params.sourceFileKey,
      sourceScheduleId: params.sourceScheduleId,
      sourceMessageId: params.sourceMessageId,
      csvDashboardId: params.csvDashboardId,
    });
    const canonicalResult = await this.canonicalResolver.rebuildForSource({
      locationKey: params.locationKey,
      sourceFileKey: params.sourceFileKey,
      csvDashboardId: params.csvDashboardId,
    });
    return {
      ...importResult,
      ...canonicalResult,
    };
  }

  async rebuildCanonical(params: {
    locationKey: string;
    csvDashboardId?: string;
  }) {
    return this.canonicalResolver.rebuildAll({
      locationKey: params.locationKey,
      csvDashboardId: params.csvDashboardId,
    });
  }

  async rebuildFeatures(params: {
    locationKey: string;
    csvDashboardId?: string;
  }) {
    return this.aggregateService.rebuild({
      locationKey: params.locationKey,
      csvDashboardId: params.csvDashboardId,
    });
  }

  async importAndRebuild(params: {
    buffer: Buffer;
    sourceFileKey: string;
    locationKey: string;
    sourceScheduleId?: string;
    sourceMessageId?: string;
    csvDashboardId?: string;
  }) {
    const importResult = await this.importFromCsv(params);
    const aggregateResult = await this.rebuildFeatures({
      locationKey: params.locationKey,
      csvDashboardId: params.csvDashboardId,
    });
    return {
      ...importResult,
      ...aggregateResult,
    };
  }
}
