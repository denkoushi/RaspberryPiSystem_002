import {
  OVERLAY_CROP_MIN_RATIO,
  OVERLAY_CROP_NUDGE_RATIO,
  clampOverlayRatio,
  clipOverlayLineToCrop,
  cropPointToOverlaySourcePoint,
  isOverlayPointInCrop,
  isValidOverlayCropRect,
  normalizeOverlayCropRect,
  sourcePointToOverlayCropPoint
} from '../overlay/overlay-geometry.js';

import type {
  OverlayCropRect,
  OverlayLine,
  OverlayPoint
} from '../overlay/overlay-geometry.js';

/**
 * Assembly compatibility constants. Geometry itself is implemented by the
 * domain-neutral overlay module so future document domains share one contract.
 */
export const ASSEMBLY_PROCEDURE_CROP_MIN_RATIO = OVERLAY_CROP_MIN_RATIO;
export const ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO = OVERLAY_CROP_NUDGE_RATIO;

export const ASSEMBLY_PROCEDURE_STEP_MAX_COUNT = 300;
export const ASSEMBLY_PROCEDURE_STEP_TITLE_MAX_LENGTH = 120;
export const ASSEMBLY_PROCEDURE_STEP_INSTRUCTION_MAX_LENGTH = 1_000;

export const ASSEMBLY_PROCEDURE_STEP_VIEW_MODES = ['FULL_PAGE', 'CROP'] as const;
export type AssemblyProcedureStepViewMode =
  (typeof ASSEMBLY_PROCEDURE_STEP_VIEW_MODES)[number];

export const ASSEMBLY_PROCEDURE_STEP_EMPHASES = [
  'NORMAL',
  'IMPORTANT',
  'CAUTION'
] as const;
export type AssemblyProcedureStepEmphasis =
  (typeof ASSEMBLY_PROCEDURE_STEP_EMPHASES)[number];

/** @deprecated Use OverlayPoint from `@raspi-system/shared-types/overlay`. */
export type AssemblyProcedurePoint = OverlayPoint;

/** @deprecated Use OverlayCropRect from `@raspi-system/shared-types/overlay`. */
export type AssemblyProcedureCropRect = OverlayCropRect;

/** @deprecated Use OverlayLine from `@raspi-system/shared-types/overlay`. */
export type AssemblyProcedureLine = OverlayLine;

/** @deprecated Use clampOverlayRatio from `@raspi-system/shared-types/overlay`. */
export const clampAssemblyProcedureRatio = clampOverlayRatio;

/** @deprecated Use normalizeOverlayCropRect from `@raspi-system/shared-types/overlay`. */
export const normalizeAssemblyProcedureCropRect = normalizeOverlayCropRect;

/** @deprecated Use isValidOverlayCropRect from `@raspi-system/shared-types/overlay`. */
export const isValidAssemblyProcedureCropRect = isValidOverlayCropRect;

/** @deprecated Use isOverlayPointInCrop from `@raspi-system/shared-types/overlay`. */
export const isAssemblyProcedurePointInCrop = isOverlayPointInCrop;

/** @deprecated Use sourcePointToOverlayCropPoint from `@raspi-system/shared-types/overlay`. */
export const sourcePointToAssemblyProcedureCropPoint =
  sourcePointToOverlayCropPoint;

/** @deprecated Use cropPointToOverlaySourcePoint from `@raspi-system/shared-types/overlay`. */
export const cropPointToAssemblyProcedureSourcePoint =
  cropPointToOverlaySourcePoint;

/** @deprecated Use clipOverlayLineToCrop from `@raspi-system/shared-types/overlay`. */
export const clipAssemblyProcedureLineToCrop = clipOverlayLineToCrop;
