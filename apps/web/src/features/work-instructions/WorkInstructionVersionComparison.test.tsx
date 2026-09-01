import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkInstructionVersionComparison } from './WorkInstructionVersionComparison';

import type {
  WorkInstructionEditAssetDto,
  WorkInstructionEditorRowDto,
  WorkInstructionEditorStepDto,
  WorkInstructionSourceVersionDto
} from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

const { useProtectedImageBlobUrlMock } = vi.hoisted(() => ({
  useProtectedImageBlobUrlMock: vi.fn()
}));

vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: useProtectedImageBlobUrlMock
}));

function makeStep(overrides: Partial<WorkInstructionEditorStepDto> = {}): WorkInstructionEditorStepDto {
  return {
    stepKey: 'sharepoint:work-instructions:1:1',
    sourceVersionId: 'source-version-1',
    sourceSystem: 'sharepoint',
    sourceList: 'work-instructions',
    sourceItemId: 1,
    step: 1,
    text: '公開版の原本メモ',
    imageName: null,
    imageAssetId: null,
    imageUrl: null,
    imageMimeType: null,
    imageSha256: null,
    sourceModified: '2026-09-01T00:00:00.000Z',
    contentHash: 'content-hash',
    overlays: [],
    ...overrides
  };
}

function makeVersion(
  id: string,
  step: WorkInstructionEditorStepDto,
  assets?: Record<string, WorkInstructionEditAssetDto>
): WorkInstructionSourceVersionDto {
  return {
    id,
    revisionNumber: 1,
    sourceModified: '2026-09-01T00:00:00.000Z',
    contentHash: 'content-hash',
    status: 'published',
    steps: [step],
    ...(assets ? { assets } : {})
  };
}

function makeRow(
  publishedStep: WorkInstructionEditorStepDto,
  options: {
    latestStep?: WorkInstructionEditorStepDto;
    publishedAssets?: Record<string, WorkInstructionEditAssetDto>;
  } = {}
): WorkInstructionEditorRowDto {
  const latestStep = options.latestStep ?? makeStep({
    sourceVersionId: 'source-version-2',
    text: '最新原本のメモ'
  });

  return {
    rowId: 'row-1',
    source: { system: 'sharepoint', list: 'work-instructions', itemId: 1 },
    published: makeVersion('source-version-1', publishedStep, options.publishedAssets),
    latest: makeVersion('source-version-2', latestStep),
    draft: null,
    updateAvailable: true
  };
}

function imageOverlay(id: string, assetId: string): WorkInstructionOverlayElement {
  return {
    id,
    pageIndex: 0,
    kind: 'IMAGE',
    assetId,
    bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 },
    zIndex: 1
  };
}

describe('WorkInstructionVersionComparison', () => {
  beforeEach(() => {
    useProtectedImageBlobUrlMock.mockReset();
    useProtectedImageBlobUrlMock.mockReturnValue({ blobUrl: 'blob:comparison-asset', error: null });
  });

  it('renders the published memo override instead of immutable source text', () => {
    const publishedStep = makeStep({ memoOverride: '公開版で採用されたメモ' });

    render(
      <WorkInstructionVersionComparison
        row={makeRow(publishedStep)}
        selectedStepKey={publishedStep.stepKey}
      />
    );

    const publishedPane = screen.getByRole('region', { name: '公開版（使用側）' });
    expect(within(publishedPane).getByText('公開版で採用されたメモ')).toBeInTheDocument();
    expect(within(publishedPane).queryByText('公開版の原本メモ')).not.toBeInTheDocument();
  });

  it('falls back to the published source text when no memo override exists', () => {
    const publishedStep = makeStep();

    render(
      <WorkInstructionVersionComparison
        row={makeRow(publishedStep)}
        selectedStepKey={publishedStep.stepKey}
      />
    );

    const publishedPane = screen.getByRole('region', { name: '公開版（使用側）' });
    expect(within(publishedPane).getByText('公開版の原本メモ')).toBeInTheDocument();
  });

  it('resolves published-only overlay assets from the published asset map', () => {
    const publishedAssetId = 'published-old-overlay-asset';
    const draftAssetId = 'draft-current-overlay-asset';
    const publishedStep = makeStep({
      imageUrl: '/api/work-instructions/assets/published-source-image',
      overlays: [imageOverlay('published-overlay', publishedAssetId)]
    });
    const latestStep = makeStep({
      sourceVersionId: 'source-version-2',
      text: '最新原本のメモ',
      imageUrl: '/api/work-instructions/assets/latest-source-image',
      overlays: [imageOverlay('draft-overlay', draftAssetId)]
    });

    render(
      <WorkInstructionVersionComparison
        row={makeRow(publishedStep, {
          latestStep,
          publishedAssets: {
            [publishedAssetId]: {
              assetId: publishedAssetId,
              url: `/api/work-instructions/edit-assets/${publishedAssetId}`
            }
          }
        })}
        selectedStepKey={publishedStep.stepKey}
        assets={{
          [draftAssetId]: {
            assetId: draftAssetId,
            url: `/api/work-instructions/edit-assets/${draftAssetId}`
          }
        }}
      />
    );

    expect(useProtectedImageBlobUrlMock).toHaveBeenCalledWith(
      `/api/work-instructions/edit-assets/${publishedAssetId}`
    );
    expect(useProtectedImageBlobUrlMock).toHaveBeenCalledWith(
      `/api/work-instructions/edit-assets/${draftAssetId}`
    );
  });
});
