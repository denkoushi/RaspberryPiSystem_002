import {
  clipAssemblyProcedureLineToCrop,
  cropPointToAssemblyProcedureSourcePoint,
  isAssemblyProcedurePointInCrop,
  sourcePointToAssemblyProcedureCropPoint
} from '@raspi-system/shared-types';

import type {
  AssemblyProcedureCropRect,
  AssemblyProcedurePoint
} from '@raspi-system/shared-types';

export type AssemblyProcedureProjectableMarker = AssemblyProcedurePoint & {
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
};

/**
 * Projects a marker that has already been filtered to the source page into a
 * crop-local coordinate space. Document/page membership deliberately does not
 * belong here: presentation models do not carry persistence references.
 */
export function projectAssemblyProcedureMarkerToCrop<
  T extends AssemblyProcedureProjectableMarker
>(marker: T, crop: AssemblyProcedureCropRect | null): T | null {
  if (!crop) return marker;
  if (!isAssemblyProcedurePointInCrop(marker, crop)) return null;

  const position = sourcePointToAssemblyProcedureCropPoint(marker, crop);
  const callout =
    marker.calloutTipXRatio != null && marker.calloutTipYRatio != null
      ? clipAssemblyProcedureLineToCrop(
          {
            start: marker,
            end: {
              xRatio: marker.calloutTipXRatio,
              yRatio: marker.calloutTipYRatio
            }
          },
          crop
        )
      : null;

  return {
    ...marker,
    ...position,
    calloutTipXRatio: callout?.end.xRatio ?? null,
    calloutTipYRatio: callout?.end.yRatio ?? null
  };
}

export function projectAssemblyProcedureMarkersToCrop<
  T extends AssemblyProcedureProjectableMarker
>(markers: T[], crop: AssemblyProcedureCropRect | null): T[] {
  return markers.flatMap((marker) => {
    const projected = projectAssemblyProcedureMarkerToCrop(marker, crop);
    return projected ? [projected] : [];
  });
}

export function assemblyProcedureViewPointToSourcePoint(
  point: AssemblyProcedurePoint,
  crop: AssemblyProcedureCropRect | null
): AssemblyProcedurePoint {
  return crop ? cropPointToAssemblyProcedureSourcePoint(point, crop) : point;
}
