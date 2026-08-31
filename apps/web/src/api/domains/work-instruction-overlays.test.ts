import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import {
  copyWorkInstructionOverlayDraft,
  createWorkInstructionImageRegion,
  deleteWorkInstructionSourceVersionImages,
  publishWorkInstructionOverlayDraft,
  uploadWorkInstructionOverlayImage
} from './work-instruction-overlays';

vi.mock('../http', () => ({
  api: {
    delete: vi.fn(),
    post: vi.fn()
  }
}));

const apiPost = vi.mocked(api.post);
const apiDelete = vi.mocked(api.delete);

const emptyMigration = {
  total: 0,
  migrated: 0,
  needsReview: 0,
  unassigned: 0,
  skipped: 0
};

describe('work-instruction overlay API client', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiDelete.mockReset();
  });

  it('keeps every source row in the draft-copy request and adapts the group response', async () => {
    const group = {
      partNumber: 'PART-1',
      shootingTarget: '加工',
      rows: [],
      migration: emptyMigration
    };
    const revision = { id: 'revision-1', sourceVersionId: 'version-2' };
    apiPost.mockResolvedValueOnce({ data: { group, revisions: [revision] } } as never);

    const result = await copyWorkInstructionOverlayDraft({
      partNumber: 'PART-1',
      shootingTarget: '加工',
      accessPassword: '2520',
      rows: [
        { rowId: 'row-1', publishedSourceVersionId: 'published-1', latestSourceVersionId: 'latest-1' },
        { rowId: 'row-2', publishedSourceVersionId: 'published-2', latestSourceVersionId: 'latest-2' }
      ]
    });

    expect(apiPost).toHaveBeenCalledWith('/work-instructions/editor-revisions/copy', {
      partNumber: 'PART-1',
      shootingTarget: '加工',
      accessPassword: '2520',
      rows: [
        { rowId: 'row-1', publishedSourceVersionId: 'published-1', latestSourceVersionId: 'latest-1' },
        { rowId: 'row-2', publishedSourceVersionId: 'published-2', latestSourceVersionId: 'latest-2' }
      ]
    });
    expect(result).toEqual({ group, revisions: [revision] });
  });

  it('publishes all revision ids with per-row optimistic versions and uses version-scoped image deletion', async () => {
    const group = { partNumber: 'PART-1', shootingTarget: '加工', rows: [], migration: emptyMigration };
    apiPost.mockResolvedValueOnce({ data: { group } } as never);
    apiDelete.mockResolvedValueOnce({ data: { results: [], deletedCount: 0 } } as never);

    await publishWorkInstructionOverlayDraft({
      partNumber: 'PART-1',
      shootingTarget: '加工',
      revisionIds: ['revision-1', 'revision-2'],
      expectedEditVersions: { 'revision-1': 3, 'revision-2': 7 },
      accessPassword: '2520',
      confirmUnassigned: true
    });
    const deletion = await deleteWorkInstructionSourceVersionImages({ sourceVersionId: 'version-2', accessPassword: '2520' });

    expect(apiPost).toHaveBeenCalledWith('/work-instructions/editor-revisions/publish', {
      partNumber: 'PART-1',
      shootingTarget: '加工',
      revisionIds: ['revision-1', 'revision-2'],
      expectedEditVersions: { 'revision-1': 3, 'revision-2': 7 },
      accessPassword: '2520',
      confirmUnassigned: true
    });
    expect(apiDelete).toHaveBeenCalledWith('/work-instructions/source-versions/version-2/image', {
      data: { accessPassword: '2520' }
    });
    expect(deletion).toEqual({ results: [], deletedCount: 0 });
  });

  it('normalizes canonical ROI asset fields for the editor overlay contract', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        asset: {
          id: 'asset-roi-1',
          storageKey: 'edit/asset-roi-1.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          sha256: 'a'.repeat(64),
          status: 'STAGED',
          origin: 'ROI',
          originSourceVersionId: 'source-version-1',
          originSourceStep: 2,
          originBbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 },
          imageUrl: '/api/work-instructions/edit-assets/asset-roi-1'
        }
      }
    } as never);

    const result = await createWorkInstructionImageRegion({
      revisionId: 'revision-1',
      stepKey: 'sharepoint:work-instructions:1:2',
      accessPassword: '2520',
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 }
    });

    expect(result).toMatchObject({
      assetId: 'asset-roi-1',
      contentType: 'image/png',
      byteSize: 42,
      url: '/api/work-instructions/edit-assets/asset-roi-1',
      origin: 'ROI',
      originSourceStep: 2
    });
  });

  it('normalizes canonical upload asset fields and keeps provenance metadata', async () => {
    apiPost.mockResolvedValueOnce({
      data: {
        asset: {
          id: 'asset-upload-1',
          storageKey: 'edit/asset-upload-1.png',
          mimeType: 'image/png',
          sizeBytes: 17,
          sha256: 'b'.repeat(64),
          status: 'STAGED',
          origin: 'UPLOAD',
          originSourceVersionId: null,
          originSourceStep: null,
          originBbox: null,
          imageUrl: '/api/work-instructions/edit-assets/asset-upload-1'
        }
      }
    } as never);
    const file = new File(['image'], 'overlay.png', { type: 'image/png' });

    const result = await uploadWorkInstructionOverlayImage({
      revisionId: 'revision-1',
      stepKey: 'sharepoint:work-instructions:1:2',
      accessPassword: '2520',
      file
    });

    expect(result).toMatchObject({
      assetId: 'asset-upload-1',
      contentType: 'image/png',
      byteSize: 17,
      url: '/api/work-instructions/edit-assets/asset-upload-1',
      origin: 'UPLOAD'
    });
  });
});
