import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkInstructionAssetView,
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionImportMessageView,
  WorkInstructionRowView,
} from '../domain/types.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';

const verifyDueManagementAccessPassword = vi.hoisted(() => vi.fn());

vi.mock('../../production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword,
}));

import { WorkInstructionAccessService } from '../work-instruction-access.service.js';
import type { WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';
import { WorkInstructionReadService } from '../work-instruction-read.service.js';

function repositoryMock() {
  return {
    readGroup: vi.fn(),
    readPublishedGroup: vi.fn(),
    readGroups: vi.fn(),
    readPublishedGroups: vi.fn(),
    readRows: vi.fn(),
    readImportMessages: vi.fn(),
    readAsset: vi.fn(),
  } as unknown as WorkInstructionRepository;
}

const group: WorkInstructionGroupView = {
  partNumber: 'MD004',
  shootingTarget: '研削',
  rows: [],
  steps: [],
};

const summary: WorkInstructionGroupSummaryView = {
  partNumber: 'MD004',
  shootingTarget: '研削',
  rowCount: 1,
  stepCount: 2,
  latestModified: new Date('2026-08-31T00:00:00.000Z'),
};

const row: WorkInstructionRowView = {
  id: 'row-1',
  source: {
    system: 'SharePoint',
    list: 'Work Instructions',
    itemId: 1,
    modified: new Date('2026-08-31T00:00:00.000Z'),
  },
  partNumber: 'MD004',
  shootingTarget: '研削',
  contentHash: 'a'.repeat(64),
  rawManifest: { schema_version: 1 },
  steps: [],
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
};

const message: WorkInstructionImportMessageView = {
  id: 'message-1',
  gmailMessageId: 'gmail-1',
  outcome: 'APPLIED',
  error: null,
  nextRetryAt: null,
  mailCleanupPending: false,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
};

const asset: WorkInstructionAssetView = {
  assetId: 'asset-1',
  storageKey: 'work-instruction-assets/asset-1.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3,
  sha256: 'a'.repeat(64),
  status: 'ACTIVE',
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  activatedAt: new Date('2026-08-31T00:00:00.000Z'),
  deletePendingAt: null,
};

describe('WorkInstructionReadService', () => {
  it('delegates group, row, message, and summary reads to the repository', async () => {
    const repository = repositoryMock();
    const files = { read: vi.fn() } as unknown as WorkInstructionFileStorePort;
    const service = new WorkInstructionReadService(repository, files);
    const groupQuery = { partNumber: 'MD004', shootingTarget: '研削', limit: 10, offset: 2 };
    const rowsQuery = { partNumber: 'MD004', includeUnclassified: true, limit: 20, offset: 1 };
    const messagesQuery = { outcome: 'RETRYABLE' as const, limit: 5, offset: 0 };
    repository.readGroup = vi.fn().mockResolvedValue(group);
    repository.readGroups = vi.fn().mockResolvedValue([summary]);
    repository.readRows = vi.fn().mockResolvedValue([row]);
    repository.readImportMessages = vi.fn().mockResolvedValue([message]);

    await expect(service.readGroup(groupQuery)).resolves.toBe(group);
    await expect(service.readGroups(groupQuery)).resolves.toEqual([summary]);
    await expect(service.readRows(rowsQuery)).resolves.toEqual([row]);
    await expect(service.readMessages(messagesQuery)).resolves.toEqual([message]);

    expect(repository.readGroup).toHaveBeenCalledWith(groupQuery);
    expect(repository.readGroups).toHaveBeenCalledWith(groupQuery);
    expect(repository.readRows).toHaveBeenCalledWith(rowsQuery);
    expect(repository.readImportMessages).toHaveBeenCalledWith(messagesQuery);
  });

  it('uses published repository queries when the publication projection is available', async () => {
    const repository = repositoryMock();
    const service = new WorkInstructionReadService(repository, { read: vi.fn() } as unknown as WorkInstructionFileStorePort);
    const groupQuery = { partNumber: 'MD004', shootingTarget: '研削', limit: 10, offset: 0 };
    repository.readPublishedGroup = vi.fn().mockResolvedValue(group);
    repository.readPublishedGroups = vi.fn().mockResolvedValue([summary]);

    await expect(service.readPublishedGroup(groupQuery)).resolves.toBe(group);
    await expect(service.readPublishedGroups(groupQuery)).resolves.toEqual([summary]);

    expect(repository.readPublishedGroup).toHaveBeenCalledWith(groupQuery);
    expect(repository.readPublishedGroups).toHaveBeenCalledWith(groupQuery);
    expect(repository.readGroup).not.toHaveBeenCalled();
    expect(repository.readGroups).not.toHaveBeenCalled();
  });

  it('falls back to latest repository queries before publication backfill is complete', async () => {
    const repository = repositoryMock();
    repository.readPublishedGroup = undefined;
    repository.readPublishedGroups = undefined;
    repository.readGroup = vi.fn().mockResolvedValue(group);
    repository.readGroups = vi.fn().mockResolvedValue([summary]);
    const service = new WorkInstructionReadService(repository, { read: vi.fn() } as unknown as WorkInstructionFileStorePort);
    const groupQuery = { partNumber: 'MD004', shootingTarget: '研削', limit: 10, offset: 0 };

    await expect(service.readPublishedGroup(groupQuery)).resolves.toBe(group);
    await expect(service.readPublishedGroups(groupQuery)).resolves.toEqual([summary]);

    expect(repository.readGroup).toHaveBeenCalledWith(groupQuery);
    expect(repository.readGroups).toHaveBeenCalledWith(groupQuery);
  });

  it('returns only active assets and reads their bytes from durable storage', async () => {
    const repository = repositoryMock();
    const files = { read: vi.fn().mockResolvedValue(Buffer.from('img')) } as unknown as WorkInstructionFileStorePort;
    const service = new WorkInstructionReadService(repository, files);

    repository.readAsset = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ...asset, status: 'DELETE_PENDING' });
    await expect(service.readAsset('missing')).resolves.toBeNull();
    await expect(service.readAsset('pending')).resolves.toBeNull();
    expect(files.read).not.toHaveBeenCalled();

    repository.readAsset = vi.fn().mockResolvedValue(asset);
    await expect(service.readAsset(asset.assetId)).resolves.toEqual({ asset, bytes: Buffer.from('img') });
    expect(files.read).toHaveBeenCalledWith(asset);
  });
});

describe('WorkInstructionAccessService', () => {
  const service = new WorkInstructionAccessService();

  beforeEach(() => {
    verifyDueManagementAccessPassword.mockReset();
  });

  it('delegates password verification to the shared management-password boundary', async () => {
    verifyDueManagementAccessPassword.mockResolvedValue({ success: false });

    await expect(service.verifyAccessPassword(' 2520 ')).resolves.toEqual({ success: false });
    expect(verifyDueManagementAccessPassword).toHaveBeenCalledWith({
      location: 'shared',
      password: ' 2520 ',
    });
  });

  it('allows a valid password and rejects a missing or invalid password with a stable API error', async () => {
    verifyDueManagementAccessPassword.mockResolvedValueOnce({ success: true });
    await expect(service.requireAccessPassword('2520')).resolves.toBeUndefined();

    verifyDueManagementAccessPassword.mockResolvedValueOnce({ success: false });
    await expect(service.requireAccessPassword(undefined)).rejects.toMatchObject({
      statusCode: 403,
      code: 'WORK_INSTRUCTION_ACCESS_PASSWORD_INVALID',
      message: '作業要領編集の管理パスワードが違います',
    });
    expect(verifyDueManagementAccessPassword).toHaveBeenLastCalledWith({
      location: 'shared',
      password: '',
    });
  });
});
