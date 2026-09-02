import type {
  WorkInstructionAssetView,
  WorkInstructionGroupView,
  WorkInstructionGroupSummaryView,
  WorkInstructionImportMessageView,
  WorkInstructionPartCandidatePageView,
  WorkInstructionPartAliasView,
  WorkInstructionRowView,
} from './domain/types.js';
import type {
  WorkInstructionGroupsQuery,
  WorkInstructionImportMessagesQuery,
  WorkInstructionPartCandidatesQuery,
  UpsertWorkInstructionPartAliasInput,
  WorkInstructionRepository,
  WorkInstructionRowsQuery,
} from './repositories/work-instruction-repository.port.js';
import type { WorkInstructionFileStorePort } from './work-instruction-file-store.adapter.js';

export type WorkInstructionAssetResponse = {
  asset: WorkInstructionAssetView;
  bytes: Buffer;
};

/** Read-only application facade shared by HTTP routes and future API clients. */
export class WorkInstructionReadService {
  constructor(
    private readonly repository: WorkInstructionRepository,
    private readonly files: WorkInstructionFileStorePort
  ) {}

  readGroup(input: { partNumber: string; shootingTarget: string }): Promise<WorkInstructionGroupView | null> {
    return this.repository.readGroup(input);
  }

  readPublishedGroup(input: { partNumber: string; shootingTarget: string }): Promise<WorkInstructionGroupView | null> {
    return this.repository.readPublishedGroup
      ? this.repository.readPublishedGroup(input)
      : this.repository.readGroup(input);
  }

  readGroups(input: WorkInstructionGroupsQuery): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>> {
    return this.repository.readGroups(input);
  }

  readPublishedGroups(input: WorkInstructionGroupsQuery): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>> {
    return this.repository.readPublishedGroups
      ? this.repository.readPublishedGroups(input)
      : this.repository.readGroups(input);
  }

  readPublishedPartCandidates(input: WorkInstructionPartCandidatesQuery): Promise<WorkInstructionPartCandidatePageView> {
    return this.repository.readPublishedPartCandidates(input);
  }

  readPublishedPartAlias(scannedPartNumber: string): Promise<WorkInstructionPartAliasView | null> {
    return this.repository.readPublishedPartAlias(scannedPartNumber);
  }

  upsertPartAlias(input: UpsertWorkInstructionPartAliasInput): Promise<WorkInstructionPartAliasView> {
    return this.repository.upsertPartAlias(input);
  }

  readRows(input: WorkInstructionRowsQuery): Promise<ReadonlyArray<WorkInstructionRowView>> {
    return this.repository.readRows(input);
  }

  readMessages(input: WorkInstructionImportMessagesQuery): Promise<ReadonlyArray<WorkInstructionImportMessageView>> {
    return this.repository.readImportMessages(input);
  }

  async readAsset(assetId: string): Promise<WorkInstructionAssetResponse | null> {
    const asset = await this.repository.readAsset(assetId);
    if (!asset || asset.status !== 'ACTIVE') return null;
    const bytes = await this.files.read(asset);
    return { asset, bytes };
  }
}
