import { randomUUID } from 'node:crypto';

import {
  isValidAssemblyProcedureOverlayBBox,
  type AssemblyProcedureImageObjectFit,
  type AssemblyProcedureOverlayElement,
  type AssemblyProcedureOverlayMask,
  type AssemblyProcedureOverlayShapeKind,
  type AssemblyProcedureOverlayTextStyle
} from '@raspi-system/shared-types';
import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

type OverlayElementInputWithOptionalId<T extends { id: string }> = Omit<T, 'id'> & {
  id?: string;
};

export type AssemblyProcedureOverlayElementInput =
  | OverlayElementInputWithOptionalId<Extract<AssemblyProcedureOverlayElement, { kind: 'TEXT' }>>
  | OverlayElementInputWithOptionalId<Extract<AssemblyProcedureOverlayElement, { kind: 'IMAGE' }>>
  | OverlayElementInputWithOptionalId<Extract<AssemblyProcedureOverlayElement, { kind: 'SHAPE' }>>;

export type AssemblyProcedureOverlayElementRow = Prisma.AssemblyProcedureOverlayElementGetPayload<{
  include: { asset: true };
}>;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeId(id: string | undefined): string {
  const value = id?.trim();
  if (!value) return randomUUID();
  if (value.length > 120) throw new ApiError(400, 'overlay IDは120文字以内にしてください');
  return value;
}

function normalizeMask(mask: AssemblyProcedureOverlayMask | undefined): {
  maskEnabled: boolean;
  maskColor: string | null;
} {
  if (!mask) return { maskEnabled: false, maskColor: null };
  const color = mask.color?.trim() ?? '';
  if (mask.enabled && !color) {
    throw new ApiError(400, 'overlayマスク色が必要です');
  }
  if (color.length > 40) throw new ApiError(400, 'overlayマスク色は40文字以内にしてください');
  return { maskEnabled: mask.enabled, maskColor: color || null };
}

function normalizePoint(
  point: { xRatio: number; yRatio: number } | undefined,
  label: string
): { xRatio: number; yRatio: number } | null {
  if (!point) return null;
  if (
    !finite(point.xRatio) ||
    !finite(point.yRatio) ||
    point.xRatio < 0 ||
    point.xRatio > 1 ||
    point.yRatio < 0 ||
    point.yRatio > 1
  ) {
    throw new ApiError(400, `${label}座標は0から1の範囲で指定してください`);
  }
  return { xRatio: point.xRatio, yRatio: point.yRatio };
}

function normalizeTextStyle(style: AssemblyProcedureOverlayTextStyle | undefined):
  | Prisma.InputJsonValue
  | undefined {
  if (style == null) return undefined;
  if (typeof style !== 'object') throw new ApiError(400, 'TEXTのstyleが不正です');
  return style as unknown as Prisma.InputJsonValue;
}

export function normalizeElement(
  input: AssemblyProcedureOverlayElementInput,
  index: number
): AssemblyProcedureOverlayElement & { id: string } {
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0) {
    throw new ApiError(400, `overlay ${index + 1}件目のページ番号が不正です`);
  }
  if (!isValidAssemblyProcedureOverlayBBox(input.bbox)) {
    throw new ApiError(400, `overlay ${index + 1}件目のbboxがページ範囲外です`);
  }
  const zIndex = input.zIndex ?? 0;
  if (!Number.isInteger(zIndex)) throw new ApiError(400, `overlay ${index + 1}件目のzIndexが不正です`);
  const opacity = input.opacity ?? 1;
  if (!finite(opacity) || opacity < 0 || opacity > 1) {
    throw new ApiError(400, `overlay ${index + 1}件目のopacityが不正です`);
  }
  const mask = input.mask ? { ...input.mask } : undefined;
  const normalizedMask = normalizeMask(mask);
  const base = {
    ...input,
    id: normalizeId(input.id),
    zIndex,
    opacity,
    mask: normalizedMask.maskEnabled
      ? { enabled: true, color: normalizedMask.maskColor! }
      : undefined
  } as AssemblyProcedureOverlayElement & { id: string };

  switch (input.kind) {
    case 'TEXT': {
      const text = input.text.trim();
      if (!text) throw new ApiError(400, `overlay ${index + 1}件目のTEXTが空です`);
      if (text.length > 10_000) throw new ApiError(400, `overlay ${index + 1}件目のTEXTが長すぎます`);
      return {
        ...base,
        kind: 'TEXT',
        text,
        style: input.style
      };
    }
    case 'IMAGE': {
      const assetId = input.assetId.trim();
      if (!assetId) throw new ApiError(400, `overlay ${index + 1}件目のassetIdが必要です`);
      const objectFit = input.objectFit ?? 'contain';
      if (!['contain', 'cover', 'fill'].includes(objectFit)) {
        throw new ApiError(400, `overlay ${index + 1}件目のobjectFitが不正です`);
      }
      return {
        ...base,
        kind: 'IMAGE',
        assetId,
        objectFit: objectFit as AssemblyProcedureImageObjectFit
      };
    }
    case 'SHAPE': {
      const shape = input.shape as AssemblyProcedureOverlayShapeKind;
      if (!['RECTANGLE', 'ELLIPSE', 'LINE', 'ARROW'].includes(shape)) {
        throw new ApiError(400, `overlay ${index + 1}件目のshapeが不正です`);
      }
      const start = normalizePoint(input.start, 'shape start');
      const end = normalizePoint(input.end, 'shape end');
      if ((shape === 'LINE' || shape === 'ARROW') && (!start || !end)) {
        throw new ApiError(400, `overlay ${index + 1}件目の線分にはstart/endが必要です`);
      }
      if (
        input.strokeWidthRatio != null &&
        (!finite(input.strokeWidthRatio) || input.strokeWidthRatio <= 0)
      ) {
        throw new ApiError(400, `overlay ${index + 1}件目のstrokeWidthRatioが不正です`);
      }
      return {
        ...base,
        kind: 'SHAPE',
        shape,
        strokeColor: input.strokeColor?.trim() || undefined,
        fillColor: input.fillColor?.trim() || undefined,
        strokeWidthRatio: input.strokeWidthRatio,
        start: start ?? undefined,
        end: end ?? undefined
      };
    }
    default:
      throw new ApiError(400, `overlay ${index + 1}件目のkindが不正です`);
  }
}

export function elementToCreateData(
  documentId: string,
  element: AssemblyProcedureOverlayElement & { id: string }
): Prisma.AssemblyProcedureOverlayElementCreateManyInput {
  const mask = element.mask;
  const common = {
    id: element.id,
    documentId,
    pageIndex: element.pageIndex,
    kind: element.kind,
    xRatio: element.bbox.xRatio,
    yRatio: element.bbox.yRatio,
    widthRatio: element.bbox.widthRatio,
    heightRatio: element.bbox.heightRatio,
    zIndex: element.zIndex,
    opacity: element.opacity ?? 1,
    maskEnabled: mask?.enabled ?? false,
    maskColor: mask?.color ?? null,
    text: null,
    textStyle: undefined,
    assetId: null,
    objectFit: null,
    shapeKind: null,
    strokeColor: null,
    fillColor: null,
    strokeWidthRatio: null,
    shapeStartXRatio: null,
    shapeStartYRatio: null,
    shapeEndXRatio: null,
    shapeEndYRatio: null
  };
  if (element.kind === 'TEXT') {
    return {
      ...common,
      text: element.text,
      textStyle: normalizeTextStyle(element.style)
    };
  }
  if (element.kind === 'IMAGE') {
    return {
      ...common,
      assetId: element.assetId,
      objectFit: element.objectFit ?? 'contain'
    };
  }
  return {
    ...common,
    shapeKind: element.shape,
    strokeColor: element.strokeColor ?? null,
    fillColor: element.fillColor ?? null,
    strokeWidthRatio: element.strokeWidthRatio ?? null,
    shapeStartXRatio: element.start?.xRatio ?? null,
    shapeStartYRatio: element.start?.yRatio ?? null,
    shapeEndXRatio: element.end?.xRatio ?? null,
    shapeEndYRatio: element.end?.yRatio ?? null
  };
}

export function overlayToCreateDataFromRow(
  documentId: string,
  overlay: AssemblyProcedureOverlayElementRow
): Prisma.AssemblyProcedureOverlayElementCreateManyInput {
  return {
    id: overlay.id,
    documentId,
    pageIndex: overlay.pageIndex,
    kind: overlay.kind,
    xRatio: overlay.xRatio,
    yRatio: overlay.yRatio,
    widthRatio: overlay.widthRatio,
    heightRatio: overlay.heightRatio,
    zIndex: overlay.zIndex,
    opacity: overlay.opacity,
    maskEnabled: overlay.maskEnabled,
    maskColor: overlay.maskColor,
    text: overlay.text,
    textStyle: overlay.textStyle ?? undefined,
    assetId: overlay.assetId,
    objectFit: overlay.objectFit,
    shapeKind: overlay.shapeKind,
    strokeColor: overlay.strokeColor,
    fillColor: overlay.fillColor,
    strokeWidthRatio: overlay.strokeWidthRatio,
    shapeStartXRatio: overlay.shapeStartXRatio,
    shapeStartYRatio: overlay.shapeStartYRatio,
    shapeEndXRatio: overlay.shapeEndXRatio,
    shapeEndYRatio: overlay.shapeEndYRatio
  };
}
