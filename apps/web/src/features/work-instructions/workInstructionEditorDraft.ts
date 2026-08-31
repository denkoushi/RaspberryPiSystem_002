import {
  convertOverlayShapeKind,
  createOverlayForRange,
  normalizeOverlayBBox,
  overlayDraftReducer,
  overlayDraftSnapshot,
  updateOverlayBBox
} from '../overlays/overlayDraft';

import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';
import type {
  OverlayBBox,
  OverlayShapeKind
} from '@raspi-system/shared-types';

export type WorkInstructionOverlayDraftAction =
  | { type: 'replace'; elements: WorkInstructionOverlayElement[] }
  | { type: 'add'; element: WorkInstructionOverlayElement }
  | { type: 'update'; element: WorkInstructionOverlayElement }
  | { type: 'remove'; id: string }
  | { type: 'bringForward'; id: string }
  | { type: 'sendBackward'; id: string }
  | { type: 'nudge'; id: string; dxRatio: number; dyRatio: number }
  | { type: 'clear' };

/**
 * WorkInstruction adds only the stable source-step locator; coordinate and
 * z-order behavior stays in the domain-neutral reducer.
 */
export function workInstructionOverlayDraftReducer(
  state: WorkInstructionOverlayElement[],
  action: WorkInstructionOverlayDraftAction
): WorkInstructionOverlayElement[] {
  return overlayDraftReducer(state, action) as WorkInstructionOverlayElement[];
}

export type WorkInstructionOverlayCreationKind = 'TEXT' | 'IMAGE' | 'SHAPE';

export function createWorkInstructionOverlayForRange(
  kind: WorkInstructionOverlayCreationKind,
  pageIndex: number,
  stepKey: string,
  bbox: OverlayBBox
): WorkInstructionOverlayElement {
  return {
    ...createOverlayForRange(kind, pageIndex, bbox),
    stepKey
  } as WorkInstructionOverlayElement;
}

export function updateWorkInstructionOverlayBBox(
  element: WorkInstructionOverlayElement,
  bbox: OverlayBBox
): WorkInstructionOverlayElement {
  return updateOverlayBBox(element, bbox) as WorkInstructionOverlayElement;
}

export function convertWorkInstructionOverlayShapeKind(
  element: Extract<WorkInstructionOverlayElement, { kind: 'SHAPE' }>,
  shape: OverlayShapeKind
): Extract<WorkInstructionOverlayElement, { kind: 'SHAPE' }> {
  return convertOverlayShapeKind(element, shape) as Extract<WorkInstructionOverlayElement, { kind: 'SHAPE' }>;
}

export function normalizeWorkInstructionOverlayBBox(
  bbox: OverlayBBox
): OverlayBBox {
  return normalizeOverlayBBox(bbox);
}

export function workInstructionOverlayDraftSnapshot(
  elements: WorkInstructionOverlayElement[]
): string {
  return JSON.stringify(
    elements
      .map((element) => ({ ...element }))
      .sort((left, right) => `${left.stepKey ?? ''}:${left.id}`.localeCompare(`${right.stepKey ?? ''}:${right.id}`))
  );
}

export function isWorkInstructionOverlayDraftSaveable(
  elements: WorkInstructionOverlayElement[]
): boolean {
  return elements.every((element) => {
    if (element.kind === 'TEXT') return element.text.trim().length > 0;
    if (element.kind === 'IMAGE') return element.assetId.trim().length > 0;
    return true;
  });
}

export function overlayElementsForStep(
  elements: WorkInstructionOverlayElement[],
  stepKey: string,
  pageIndex: number
): WorkInstructionOverlayElement[] {
  return elements
    .filter((element) => element.stepKey === stepKey || (element.stepKey == null && element.pageIndex === pageIndex))
    .map((element) => ({ ...element, pageIndex }));
}

export function normalizeDraftElements(
  elements: WorkInstructionOverlayElement[],
  steps: ReadonlyArray<{ stepKey: string }>
): WorkInstructionOverlayElement[] {
  const stepIndexes = new Map(steps.map((step, index) => [step.stepKey, index]));
  return elements.map((element) => ({
    ...element,
    pageIndex: stepIndexes.get(element.stepKey ?? '') ?? element.pageIndex
  }));
}

export { overlayDraftSnapshot };
