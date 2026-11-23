import { ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX, assemblyProcedureOverlayBBoxCenter } from '@raspi-system/shared-types';

import type {
  AssemblyProcedureImageOverlayElement,
  AssemblyProcedureOverlayElement,
  AssemblyProcedureTextOverlayElement
} from '@raspi-system/shared-types';

export type CleanStep = {
  id: string;
  heading: string;
  body: string;
  images: AssemblyProcedureImageOverlayElement[];
};

function byTopThenLeft(a: AssemblyProcedureOverlayElement, b: AssemblyProcedureOverlayElement) {
  return a.bbox.yRatio - b.bbox.yRatio || a.bbox.xRatio - b.bbox.xRatio;
}

export function buildCleanSteps(elements: readonly AssemblyProcedureOverlayElement[]): CleanStep[] {
  const content = elements.filter(element => !element.id.startsWith(ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX));
  const texts = content.filter((element): element is AssemblyProcedureTextOverlayElement =>
    element.kind === 'TEXT' && element.text.trim() !== '').sort(byTopThenLeft);
  if (texts.length === 0) return [];

  const steps = texts.map(({ id, text }): CleanStep => {
    const [heading, ...body] = text.split(/\r\n?|\n/);
    return { id, heading, body: body.join('\n'), images: [] };
  });
  const images = content.filter((element): element is AssemblyProcedureImageOverlayElement =>
    element.kind === 'IMAGE').sort(byTopThenLeft);
  for (const image of images) {
    const imageCenter = assemblyProcedureOverlayBBoxCenter(image.bbox).yRatio;
    let bestIndex = 0;
    let bestOverlap = 0;
    let nearestDistance = Infinity;
    texts.forEach(({ bbox }, index) => {
      const overlap = Math.min(image.bbox.yRatio + image.bbox.heightRatio, bbox.yRatio + bbox.heightRatio)
        - Math.max(image.bbox.yRatio, bbox.yRatio);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      } else if (bestOverlap === 0) {
        const distance = Math.abs(imageCenter - assemblyProcedureOverlayBBoxCenter(bbox).yRatio);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          bestIndex = index;
        }
      }
    });
    steps[bestIndex].images.push(image);
  }

  return steps;
}
