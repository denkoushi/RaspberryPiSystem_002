import { z } from 'zod';

import type { OverlayCropRect, OverlayPoint } from './overlay-geometry.js';

export type OverlayBBox = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type OverlayTextStyle = {
  fontFamily?: string;
  fontSizeRatio?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  align?: 'start' | 'center' | 'end';
};

export type OverlayMask = {
  enabled: boolean;
  color: string;
};

export type OverlayImageObjectFit = 'contain' | 'cover' | 'fill';

export type OverlayShapeKind =
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'LINE'
  | 'ARROW';

const ratioSchema = z.coerce.number().finite().min(0).max(1);

/**
 * Runtime contract for a page-relative rectangle. This is also used for
 * source-page ROIs, so invalid coordinates are rejected before a renderer or
 * asset service is invoked.
 */
export const overlayBBoxSchema = z
  .object({
    xRatio: ratioSchema,
    yRatio: ratioSchema,
    widthRatio: z.coerce.number().finite().positive().max(1),
    heightRatio: z.coerce.number().finite().positive().max(1)
  })
  .superRefine((bbox, ctx) => {
    if (bbox.xRatio + bbox.widthRatio > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bboxのX座標と幅がページ範囲外です',
        path: ['widthRatio']
      });
    }
    if (bbox.yRatio + bbox.heightRatio > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bboxのY座標と高さがページ範囲外です',
        path: ['heightRatio']
      });
    }
  });

/** Alias used by image/text extraction endpoints. */
export const overlayRegionBBoxSchema = overlayBBoxSchema;

const pointSchema = z.object({
  xRatio: ratioSchema,
  yRatio: ratioSchema
});

const textStyleSchema = z.object({
  fontFamily: z.string().trim().max(120).optional(),
  fontSizeRatio: z.coerce.number().finite().positive().optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  color: z.string().trim().max(40).optional(),
  align: z.enum(['start', 'center', 'end']).optional()
});

const maskSchema = z
  .object({
    enabled: z.boolean(),
    color: z.string().trim().max(40)
  })
  .superRefine((mask, ctx) => {
    if (mask.enabled && !mask.color) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'overlayマスク色が必要です',
        path: ['color']
      });
    }
  });

const overlayElementBaseSchema = z.object({
  id: z.string().trim().max(120).optional(),
  pageIndex: z.coerce.number().int().min(0),
  bbox: overlayBBoxSchema,
  zIndex: z.coerce.number().int().default(0),
  opacity: z.coerce.number().finite().min(0).max(1).default(1),
  mask: maskSchema.optional()
});

const textOverlayElementSchema = overlayElementBaseSchema.extend({
  kind: z.literal('TEXT'),
  text: z.string().trim().min(1).max(10_000),
  style: textStyleSchema.optional()
});

const imageOverlayElementSchema = overlayElementBaseSchema.extend({
  kind: z.literal('IMAGE'),
  assetId: z.string().trim().min(1).max(120),
  objectFit: z.enum(['contain', 'cover', 'fill']).default('contain')
});

const shapeOverlayElementSchema = overlayElementBaseSchema.extend({
  kind: z.literal('SHAPE'),
  shape: z.enum(['RECTANGLE', 'ELLIPSE', 'LINE', 'ARROW']),
  strokeColor: z.string().trim().max(40).optional(),
  fillColor: z.string().trim().max(40).optional(),
  strokeWidthRatio: z.coerce.number().finite().positive().optional(),
  start: pointSchema.optional(),
  end: pointSchema.optional()
});

/** Complete persisted overlay element contract. */
export const overlayElementSchema = z
  .discriminatedUnion('kind', [
    textOverlayElementSchema,
    imageOverlayElementSchema,
    shapeOverlayElementSchema
  ])
  .superRefine((element, ctx) => {
    if (element.kind === 'SHAPE' && (element.shape === 'LINE' || element.shape === 'ARROW')) {
      if (!element.start || !element.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '線分にはstart/endが必要です',
          path: ['start']
        });
      }
    }
  });

/** Input contract; id, zIndex and opacity may be omitted for new elements. */
export const overlayElementInputSchema = overlayElementSchema;

export type OverlayElementInput = z.input<typeof overlayElementInputSchema>;

/** Shared body contract for saving a revision's overlay set. */
export const overlaySaveInputSchema = z.object({
  accessPassword: z.string().max(128).default(''),
  expectedEditVersion: z.coerce.number().int().min(0),
  elements: z.array(overlayElementInputSchema)
});

/** Shared body contract for image/text extraction from a page ROI. */
export const overlayRegionInputSchema = z.object({
  accessPassword: z.string().max(128).default(''),
  pageIndex: z.coerce.number().int().min(0),
  bbox: overlayRegionBBoxSchema
});

type OverlayElementBase = {
  id: string;
  pageIndex: number;
  bbox: OverlayBBox;
  zIndex: number;
  opacity?: number;
  mask?: OverlayMask;
};

export type OverlayTextElement = OverlayElementBase & {
  kind: 'TEXT';
  text: string;
  style?: OverlayTextStyle;
};

export type OverlayImageElement = OverlayElementBase & {
  kind: 'IMAGE';
  assetId: string;
  objectFit?: OverlayImageObjectFit;
};

export type OverlayShapeElement = OverlayElementBase & {
  kind: 'SHAPE';
  shape: OverlayShapeKind;
  strokeColor?: string;
  fillColor?: string;
  strokeWidthRatio?: number;
  start?: OverlayPoint;
  end?: OverlayPoint;
};

/**
 * Discriminated overlay union shared by API and Web. Consumers must branch on
 * `kind` before reading variant-specific fields.
 */
export type OverlayElement =
  | OverlayTextElement
  | OverlayImageElement
  | OverlayShapeElement;

const OVERLAY_RATIO_EPSILON = 1e-9;

function finiteRatio(value: number): boolean {
  return Number.isFinite(value);
}

export function isValidOverlayBBox(bbox: OverlayBBox): boolean {
  return (
    finiteRatio(bbox.xRatio) &&
    finiteRatio(bbox.yRatio) &&
    finiteRatio(bbox.widthRatio) &&
    finiteRatio(bbox.heightRatio) &&
    bbox.xRatio >= -OVERLAY_RATIO_EPSILON &&
    bbox.yRatio >= -OVERLAY_RATIO_EPSILON &&
    bbox.widthRatio > OVERLAY_RATIO_EPSILON &&
    bbox.heightRatio > OVERLAY_RATIO_EPSILON &&
    bbox.xRatio + bbox.widthRatio <= 1 + OVERLAY_RATIO_EPSILON &&
    bbox.yRatio + bbox.heightRatio <= 1 + OVERLAY_RATIO_EPSILON
  );
}

/**
 * Returns the intersection of a source-page bbox and a crop in crop-local
 * normalized coordinates. A bbox touching the crop boundary is retained;
 * bboxes with no area in common are omitted.
 */
export function projectOverlayBBoxToCrop(
  bbox: OverlayBBox,
  crop: OverlayCropRect
): OverlayBBox | null {
  const left = Math.max(bbox.xRatio, crop.xRatio);
  const top = Math.max(bbox.yRatio, crop.yRatio);
  const right = Math.min(
    bbox.xRatio + bbox.widthRatio,
    crop.xRatio + crop.widthRatio
  );
  const bottom = Math.min(
    bbox.yRatio + bbox.heightRatio,
    crop.yRatio + crop.heightRatio
  );
  if (
    right <= left + OVERLAY_RATIO_EPSILON ||
    bottom <= top + OVERLAY_RATIO_EPSILON ||
    crop.widthRatio <= OVERLAY_RATIO_EPSILON ||
    crop.heightRatio <= OVERLAY_RATIO_EPSILON
  ) {
    return null;
  }
  return {
    xRatio: Math.max(0, Math.min(1, (left - crop.xRatio) / crop.widthRatio)),
    yRatio: Math.max(0, Math.min(1, (top - crop.yRatio) / crop.heightRatio)),
    widthRatio: Math.max(0, Math.min(1, (right - left) / crop.widthRatio)),
    heightRatio: Math.max(0, Math.min(1, (bottom - top) / crop.heightRatio))
  };
}

/** Alias with a concise name for callers that already have a bbox value. */
export const projectOverlayBBoxToCropRect = projectOverlayBBoxToCrop;

/**
 * Projects any overlay variant into a crop. The returned element keeps its
 * identity and kind while its bbox is replaced by crop-local coordinates.
 */
export function projectOverlayToCrop(
  element: OverlayElement,
  crop: OverlayCropRect
): OverlayElement | null {
  const bbox = projectOverlayBBoxToCrop(element.bbox, crop);
  if (!bbox) return null;
  return { ...element, bbox };
}

/** Alias used by renderers that call the source item an element. */
export const projectOverlayElementToCrop = projectOverlayToCrop;

/**
 * Maps a crop-local bbox back into source-page coordinates. This is the
 * inverse of the coordinate part of `projectOverlayBBoxToCrop`.
 */
export function projectOverlayBBoxFromCrop(
  bbox: OverlayBBox,
  crop: OverlayCropRect
): OverlayBBox {
  return {
    xRatio: crop.xRatio + bbox.xRatio * crop.widthRatio,
    yRatio: crop.yRatio + bbox.yRatio * crop.heightRatio,
    widthRatio: bbox.widthRatio * crop.widthRatio,
    heightRatio: bbox.heightRatio * crop.heightRatio
  };
}

/**
 * Returns the center point used for crop inclusion checks. Keeping this pure
 * lets API validation and Web rendering use exactly the same rule.
 */
export function overlayBBoxCenter(bbox: OverlayBBox): OverlayPoint {
  return {
    xRatio: bbox.xRatio + bbox.widthRatio / 2,
    yRatio: bbox.yRatio + bbox.heightRatio / 2
  };
}
