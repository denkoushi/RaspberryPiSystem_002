import {
  overlayBBoxSchema,
  overlayElementInputSchema,
  overlayElementSchema,
  overlayRegionBBoxSchema,
  overlayRegionInputSchema,
  overlaySaveInputSchema,
  overlayBBoxCenter,
  isValidOverlayBBox,
  projectOverlayBBoxFromCrop,
  projectOverlayBBoxToCrop,
  projectOverlayToCrop
} from '../overlay/normalized-overlay.js';

import type {
  OverlayBBox,
  OverlayElement,
  OverlayElementInput,
  OverlayImageElement,
  OverlayImageObjectFit,
  OverlayMask,
  OverlayShapeElement,
  OverlayShapeKind,
  OverlayTextElement,
  OverlayTextStyle
} from '../overlay/normalized-overlay.js';
import type { OverlayCropRect, OverlayPoint } from '../overlay/overlay-geometry.js';

/**
 * Assembly compatibility exports. The persisted contract and projection
 * logic are now domain-neutral; these names remain for existing API/Web
 * consumers and old payloads.
 */
export type AssemblyProcedureOverlayBBox = OverlayBBox;
export type AssemblyProcedureOverlayTextStyle = OverlayTextStyle;
export type AssemblyProcedureOverlayMask = OverlayMask;
export type AssemblyProcedureImageObjectFit = OverlayImageObjectFit;
export type AssemblyProcedureOverlayShapeKind = OverlayShapeKind;

export const assemblyProcedureOverlayBBoxSchema = overlayBBoxSchema;
export const assemblyProcedureRegionBBoxSchema = overlayRegionBBoxSchema;
export const assemblyProcedureOverlayElementSchema = overlayElementSchema;
export const assemblyProcedureOverlayElementInputSchema = overlayElementInputSchema;
export const assemblyProcedureOverlaySaveInputSchema = overlaySaveInputSchema;
export const assemblyProcedureOverlayRegionInputSchema = overlayRegionInputSchema;

export type AssemblyProcedureOverlayElementInput = OverlayElementInput;

export type AssemblyProcedureTextOverlayElement = OverlayTextElement;
export type AssemblyProcedureImageOverlayElement = OverlayImageElement;
export type AssemblyProcedureShapeOverlayElement = OverlayShapeElement;
export type AssemblyProcedureOverlayElement = OverlayElement;

export const isValidAssemblyProcedureOverlayBBox = isValidOverlayBBox;

export function projectAssemblyProcedureOverlayBBoxToCrop(
  bbox: AssemblyProcedureOverlayBBox,
  crop: OverlayCropRect
): AssemblyProcedureOverlayBBox | null {
  return projectOverlayBBoxToCrop(bbox, crop);
}

/** Alias with a concise name for callers that already have a bbox value. */
export const projectAssemblyProcedureBBoxToCrop =
  projectAssemblyProcedureOverlayBBoxToCrop;

export function projectAssemblyProcedureOverlayToCrop(
  element: AssemblyProcedureOverlayElement,
  crop: OverlayCropRect
): AssemblyProcedureOverlayElement | null {
  return projectOverlayToCrop(element, crop);
}

/** Alias used by renderers that call the source item an element. */
export const projectAssemblyProcedureOverlayElementToCrop =
  projectAssemblyProcedureOverlayToCrop;

export function projectAssemblyProcedureOverlayBBoxFromCrop(
  bbox: AssemblyProcedureOverlayBBox,
  crop: OverlayCropRect
): AssemblyProcedureOverlayBBox {
  return projectOverlayBBoxFromCrop(bbox, crop);
}

export function assemblyProcedureOverlayBBoxCenter(
  bbox: AssemblyProcedureOverlayBBox
): OverlayPoint {
  return overlayBBoxCenter(bbox);
}
