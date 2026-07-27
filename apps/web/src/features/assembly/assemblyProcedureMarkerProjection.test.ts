import { describe, expect, it } from 'vitest';

import {
  assemblyProcedureViewPointToSourcePoint,
  projectAssemblyProcedureMarkerToCrop,
  projectAssemblyProcedureMarkersToCrop
} from './assemblyProcedureMarkerProjection';

const crop = {
  xRatio: 0.2,
  yRatio: 0.25,
  widthRatio: 0.6,
  heightRatio: 0.5
};

describe('assembly procedure marker projection', () => {
  it('projects a page-filtered marker without persistence document fields', () => {
    const projected = projectAssemblyProcedureMarkerToCrop(
      {
        id: 'canvas-marker',
        markerNo: 1,
        xRatio: 0.5,
        yRatio: 0.5,
        calloutTipXRatio: 0.9,
        calloutTipYRatio: 0.5
      },
      crop
    );

    expect(projected).toMatchObject({
      id: 'canvas-marker',
      xRatio: 0.5,
      yRatio: 0.5,
      calloutTipXRatio: 1,
      calloutTipYRatio: 0.5
    });
  });

  it('includes boundary anchors and excludes markers whose anchor is outside', () => {
    const projected = projectAssemblyProcedureMarkersToCrop(
      [
        { id: 'boundary', xRatio: 0.2, yRatio: 0.25 },
        {
          id: 'outside-with-crossing-callout',
          xRatio: 0.1,
          yRatio: 0.5,
          calloutTipXRatio: 0.5,
          calloutTipYRatio: 0.5
        }
      ],
      crop
    );

    expect(projected.map((marker) => marker.id)).toEqual(['boundary']);
    expect(projected[0]).toMatchObject({ xRatio: 0, yRatio: 0 });
  });

  it('maps crop-local placement back to the source page', () => {
    expect(
      assemblyProcedureViewPointToSourcePoint(
        { xRatio: 0.5, yRatio: 0.5 },
        crop
      )
    ).toEqual({ xRatio: 0.5, yRatio: 0.5 });
    expect(
      assemblyProcedureViewPointToSourcePoint(
        { xRatio: 0.25, yRatio: 0.75 },
        crop
      )
    ).toEqual({ xRatio: 0.35, yRatio: 0.625 });
  });
});
