import { logger } from '../../../lib/logger.js';
import type { DueManagementScoringParameters } from './tuning-types.js';
import { TuningParamsRepository } from '../repositories/tuning-params.repository.js';
import { TuningHistoryRepository } from '../repositories/tuning-history.repository.js';

export class TuningRollbackService {
  constructor(
    private readonly paramsRepository: TuningParamsRepository,
    private readonly historyRepository: TuningHistoryRepository
  ) {}

  async rollbackToPreviousStable(params: {
    locationKey: string;
    reason: string;
  }): Promise<DueManagementScoringParameters | null> {
    const snapshot = await this.paramsRepository.getStableSnapshot(params.locationKey);
    if (!snapshot?.previousParams) {
      return null;
    }
    const restored = await this.paramsRepository.rollbackToPreviousStable(params.locationKey);
    await this.historyRepository.appendFailure({
      locationKey: params.locationKey,
      reason: params.reason,
      candidateParams: snapshot.params,
      previousStableParams: snapshot.previousParams,
      metrics: null,
    });
    logger.info(
      { locationKey: params.locationKey, reason: params.reason },
      '[DueManagementAutoTuning] Rollback applied'
    );
    return restored;
  }
}
