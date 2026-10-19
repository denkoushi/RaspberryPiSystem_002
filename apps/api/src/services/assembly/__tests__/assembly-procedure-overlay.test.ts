import {
  projectAssemblyProcedureOverlayBBoxFromCrop,
  projectAssemblyProcedureOverlayBBoxToCrop,
  projectAssemblyProcedureOverlayToCrop,
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

const crop: AssemblyProcedureCropRect = {
  xRatio: 0.2,
  yRatio: 0.1,
  widthRatio: 0.5,
  heightRatio: 0.6
};

describe('assembly procedure overlay projection', () => {
  it('clips a bbox and converts the surviving area to crop-local ratios', () => {
    expect(
      projectAssemblyProcedureOverlayBBoxToCrop(
        { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.3 },
        crop
      )
    ).toEqual({
      xRatio: 0,
      yRatio: (0.2 - 0.1) / 0.6,
      widthRatio: 0.4,
      heightRatio: 0.3 / 0.6
    });
  });

  it('omits boundary-only overlays and disjoint overlays', () => {
    expect(
      projectAssemblyProcedureOverlayBBoxToCrop(
        { xRatio: 0.7, yRatio: 0.1, widthRatio: 0.1, heightRatio: 0.1 },
        crop
      )
    ).toBeNull();
    expect(
      projectAssemblyProcedureOverlayBBoxToCrop(
        { xRatio: 0.71, yRatio: 0.1, widthRatio: 0.1, heightRatio: 0.1 },
        crop
      )
    ).toBeNull();
  });

  it('projects every discriminated element kind without losing variant data', () => {
    const elements: AssemblyProcedureOverlayElement[] = [
      {
        id: 'text',
        kind: 'TEXT',
        pageIndex: 0,
        bbox: { xRatio: 0.25, yRatio: 0.2, widthRatio: 0.1, heightRatio: 0.1 },
        zIndex: 1,
        text: '確認',
        style: { fontWeight: 'bold' }
      },
      {
        id: 'image',
        kind: 'IMAGE',
        pageIndex: 0,
        bbox: { xRatio: 0.25, yRatio: 0.2, widthRatio: 0.1, heightRatio: 0.1 },
        zIndex: 2,
        assetId: 'asset-1'
      },
      {
        id: 'shape',
        kind: 'SHAPE',
        pageIndex: 0,
        bbox: { xRatio: 0.25, yRatio: 0.2, widthRatio: 0.1, heightRatio: 0.1 },
        zIndex: 3,
        shape: 'ARROW',
        strokeColor: '#f00'
      }
    ];
    expect(elements.map((element) => projectAssemblyProcedureOverlayToCrop(element, crop))).toEqual([
      expect.objectContaining({ kind: 'TEXT', text: '確認', style: { fontWeight: 'bold' } }),
      expect.objectContaining({ kind: 'IMAGE', assetId: 'asset-1' }),
      expect.objectContaining({ kind: 'SHAPE', shape: 'ARROW', strokeColor: '#f00' })
    ]);
  });

  it('maps crop-local bbox back to source coordinates', () => {
    const local = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.5 };
    expect(projectAssemblyProcedureOverlayBBoxFromCrop(local, crop)).toEqual({
      xRatio: 0.25,
      yRatio: 0.22,
      widthRatio: 0.2,
      heightRatio: 0.3
    });
  });
});
