import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkInstructionVersionComparison } from './WorkInstructionVersionComparison';

import type {
  WorkInstructionEditorRowDto,
  WorkInstructionEditorStepDto,
  WorkInstructionSourceVersionDto
} from '../../api/domains/work-instruction-overlays';

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

function makeVersion(id: string, step: WorkInstructionEditorStepDto): WorkInstructionSourceVersionDto {
  return {
    id,
    revisionNumber: 1,
    sourceModified: '2026-09-01T00:00:00.000Z',
    contentHash: 'content-hash',
    status: 'published',
    steps: [step]
  };
}

function makeRow(publishedStep: WorkInstructionEditorStepDto): WorkInstructionEditorRowDto {
  const latestStep = makeStep({
    sourceVersionId: 'source-version-2',
    text: '最新原本のメモ'
  });

  return {
    rowId: 'row-1',
    source: { system: 'sharepoint', list: 'work-instructions', itemId: 1 },
    published: makeVersion('source-version-1', publishedStep),
    latest: makeVersion('source-version-2', latestStep),
    draft: null,
    updateAvailable: true
  };
}

describe('WorkInstructionVersionComparison', () => {
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
});
