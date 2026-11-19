import { createOverlayForRange } from './assemblyDocumentEditorDraft';

import type { AssemblyProcedureOverlayElement, OverlayTextElement } from '@raspi-system/shared-types';

export function placeMeetingOverflow(
  element: OverlayTextElement,
  overflow: string[],
  occupied: AssemblyProcedureOverlayElement[]
): OverlayTextElement[] {
  const { bbox, pageIndex } = element;
  const heightRatio = Math.min(0.15, bbox.heightRatio);
  const step = heightRatio + 0.01;
  const slots = Math.max(1, Math.floor(1 / step));
  const firstSlot = Math.ceil((bbox.yRatio + bbox.heightRatio) / step);
  const added: OverlayTextElement[] = [];
  for (const text of overflow) {
    const yRatio = ((firstSlot + added.length) % slots) * step;
    const next = createOverlayForRange('TEXT', pageIndex, { ...bbox, yRatio, heightRatio }, [...occupied, ...added]);
    added.push({ ...next, text, style: element.style ?? next.style });
  }
  return added;
}
