import { describe, expect, it } from 'vitest';

import {
  findWorkInstructionImageIndex,
  getWorkInstructionImageSteps,
  moveWorkInstructionImageIndex,
  workInstructionStepMemo
} from './workInstructionViewerNavigation';

import type { WorkInstructionStep } from '../../api/domains/work-instructions';

function makeStep(id: string, imageUrl: string | null, text = id): WorkInstructionStep {
  return {
    id,
    step: Number(id.replace(/\D/g, '')) || 1,
    operation: null,
    text,
    imageName: imageUrl ? `${id}.png` : null,
    imageAssetId: imageUrl ? `asset-${id}` : null,
    imageUrl,
    imageMimeType: imageUrl ? 'image/png' : null,
    imageSha256: imageUrl ? `sha-${id}` : null,
    rowId: `row-${id}`,
    source: { system: 'sharepoint', list: 'work-instructions', itemId: 1 }
  };
}

describe('work instruction viewer navigation', () => {
  it('filters only image steps without deduplicating repeated protected assets', () => {
    const steps = [
      makeStep('step-1', '/assets/shared'),
      makeStep('step-2', null),
      makeStep('step-3', '/assets/shared')
    ];

    expect(getWorkInstructionImageSteps(steps).map((step) => step.id)).toEqual(['step-1', 'step-3']);
    expect(findWorkInstructionImageIndex(getWorkInstructionImageSteps(steps), 'step-3')).toBe(1);
  });

  it('clamps movement at the first and last image and handles an empty list', () => {
    const imageSteps = [makeStep('step-1', '/assets/1'), makeStep('step-3', '/assets/3')];

    expect(moveWorkInstructionImageIndex(imageSteps, 0, -1)).toBe(0);
    expect(moveWorkInstructionImageIndex(imageSteps, 1, 1)).toBe(1);
    expect(moveWorkInstructionImageIndex(imageSteps, -1, -1)).toBe(0);
    expect(moveWorkInstructionImageIndex([], 0, 1)).toBe(-1);
    expect(findWorkInstructionImageIndex(imageSteps, null)).toBe(-1);
  });

  it('keeps an empty override effective and falls back to source text when absent', () => {
    const source = makeStep('step-1', '/assets/1', '原本のメモ');
    expect(workInstructionStepMemo(source)).toBe('原本のメモ');
    expect(workInstructionStepMemo({ ...source, effectiveMemo: '派生メモ' })).toBe('派生メモ');
    expect(workInstructionStepMemo({ ...source, memoOverride: '' })).toBe('');
  });
});
