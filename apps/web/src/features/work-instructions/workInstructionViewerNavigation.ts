import type { WorkInstructionStep } from '../../api/domains/work-instructions';

/**
 * A photo is a property of a step, not of its URL. The same protected asset
 * may intentionally be referenced by more than one step, so callers should
 * keep the filtered array in source order and navigate by step id/index.
 */
export function hasWorkInstructionImage(step: WorkInstructionStep): boolean {
  return Boolean(step.imageUrl?.trim());
}

export function workInstructionStepMemo(step: WorkInstructionStep): string {
  if (typeof step.memoOverride === 'string') return step.memoOverride;
  if (typeof step.effectiveMemo === 'string') return step.effectiveMemo;
  if (typeof step.memo === 'string') return step.memo;
  return step.text;
}

export function getWorkInstructionImageSteps(
  steps: readonly WorkInstructionStep[]
): WorkInstructionStep[] {
  return steps.filter(hasWorkInstructionImage);
}

export function findWorkInstructionImageIndex(
  steps: readonly WorkInstructionStep[],
  stepId: string | null | undefined
): number {
  if (!stepId) return -1;
  return steps.findIndex((step) => step.id === stepId);
}

export function moveWorkInstructionImageIndex(
  steps: readonly WorkInstructionStep[],
  currentIndex: number,
  delta: -1 | 1
): number {
  if (steps.length === 0) return -1;
  const safeIndex = Number.isInteger(currentIndex)
    ? Math.max(0, Math.min(steps.length - 1, currentIndex))
    : 0;
  return Math.max(0, Math.min(steps.length - 1, safeIndex + delta));
}
