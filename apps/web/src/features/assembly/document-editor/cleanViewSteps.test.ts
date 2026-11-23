import { ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { buildCleanSteps } from './cleanViewSteps';

import type { AssemblyProcedureImageOverlayElement, AssemblyProcedureTextOverlayElement } from '@raspi-system/shared-types';

function bbox(yRatio: number, heightRatio: number, xRatio = 0.1) {
  return { xRatio, yRatio, widthRatio: 0.2, heightRatio };
}

function text(id: string, value: string, y: number, h = 0.1, x?: number): AssemblyProcedureTextOverlayElement {
  return { id, kind: 'TEXT', pageIndex: 0, zIndex: 0, text: value, bbox: bbox(y, h, x) };
}

function image(id: string, y: number, h = 0.1, x?: number): AssemblyProcedureImageOverlayElement {
  return { id, assetId: id, kind: 'IMAGE', pageIndex: 0, zIndex: 0, bbox: bbox(y, h, x) };
}

describe('buildCleanSteps', () => {
  it('sorts by top then left and splits the heading from the body', () => {
    expect(buildCleanSteps([
      text('bottom', '下', 0.5, 0.1, 0),
      text('right', '右', 0.1, 0.1, 0.5),
      text('left', '左\r\n本文1\n本文2', 0.1)
    ])).toEqual([
      { id: 'left', heading: '左', body: '本文1\n本文2', images: [] },
      { id: 'right', heading: '右', body: '', images: [] },
      { id: 'bottom', heading: '下', body: '', images: [] }
    ]);
  });

  it('uses the largest overlap and sorts assigned images by top then left', () => {
    const right = image('right', 0.25, 0.25, 0.7);
    const left = image('left', 0.25, 0.25, 0.4);
    const later = image('later', 0.35, 0.1, 0.2);
    const steps = buildCleanSteps([later, right, text('bottom', '下', 0.3, 0.25), left, text('top', '上', 0.1, 0.2)]);
    expect(steps.map(step => step.images)).toEqual([[], [left, right, later]]);
  });

  it('uses the nearest vertical center when no text overlaps', () => {
    const between = image('between', 0.49, 0.02);
    const steps = buildCleanSteps([text('top', '上', 0, 0.45), between, text('bottom', '下', 0.6, 0.1)]);
    expect(steps.map(step => step.images)).toEqual([[], [between]]);
  });

  it('ignores erase overlays, whitespace, and shapes', () => {
    const erase = ASSEMBLY_PROCEDURE_TEXT_ERASE_ID_PREFIX;
    const photo = image('photo', 0.3);
    const source = [
      text(`${erase}text`, '消し込み', 0.1),
      image(`${erase}patch`, 0.3),
      text('empty', '', 0.2),
      text('blank', ' \n\t ', 0.2),
      { id: 'shape', kind: 'SHAPE', shape: 'RECTANGLE', pageIndex: 0, zIndex: 0, bbox: bbox(0.3, 0.1) } as const,
      photo
    ];
    expect(buildCleanSteps(source)).toEqual([]);
    expect(buildCleanSteps([...source, text('visible', '表示', 0.3)])).toEqual([
      { id: 'visible', heading: '表示', body: '', images: [photo] }
    ]);
  });
});
