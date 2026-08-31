import { logger } from '../../lib/logger.js';

import type { WorkInstructionEditRepository } from './repositories/work-instruction-edit-repository.port.js';
import type { WorkInstructionEditFileStorePort } from './work-instruction-edit-file-store.adapter.js';

export type WorkInstructionEditAssetCleanupResult = {
  deleted: number;
  failed: number;
};

/**
 * Reclaims editor-owned files independently from Gmail/source asset cleanup.
 * The repository claim is short and uses SKIP LOCKED; physical deletion is
 * outside the transaction, then the guarded DB delete closes the lifecycle.
 * A missing file is success by contract of the durable store, while any other
 * failure leaves DELETE_PENDING for a later scheduler tick.
 */
export class WorkInstructionEditAssetCleanupService {
  constructor(
    private readonly repository: WorkInstructionEditRepository,
    private readonly files: WorkInstructionEditFileStorePort
  ) {}

  async cleanup(now = new Date(), limit = 100): Promise<WorkInstructionEditAssetCleanupResult> {
    const candidates = await this.repository.claimEditAssetCleanupCandidates({ now, limit });
    let deleted = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.files.delete({ storageKey: candidate.storageKey });
        // eslint-disable-next-line no-await-in-loop
        const removed = await this.repository.deleteEditAssetRecord({ assetId: candidate.assetId });
        if (removed) deleted += 1;
      } catch (error) {
        failed += 1;
        await this.repository.recordEditAssetDeletionFailure({
          assetId: candidate.assetId,
          error: error instanceof Error ? error.message : String(error)
        }).catch((recordError) => {
          logger.warn({ err: recordError, assetId: candidate.assetId }, 'work_instruction_edit_asset_cleanup_failure_record_failed');
        });
        logger.error({ err: error, assetId: candidate.assetId }, 'work_instruction_edit_asset_cleanup_failed');
      }
    }
    return { deleted, failed };
  }
}
