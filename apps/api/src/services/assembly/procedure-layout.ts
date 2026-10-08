import { overlayElementSchema, type OverlayBBox, type OverlayElement, type OverlayImageElement, type OverlayTextElement } from '@raspi-system/shared-types';
import { z } from 'zod';

const structureSchema = z.object({
  titleId: z.string().min(1).nullable(),
  steps: z.array(z.object({ textId: z.string().min(1).nullable(), photoIds: z.array(z.string().min(1)) }).strict()),
  noteIds: z.array(z.string().min(1))
}).strict();
export type ProcedureLayoutStructure = z.infer<typeof structureSchema>;

/** No repairs: every text/photo must be classified exactly once. */
export function validateProcedureLayoutStructure(raw: unknown, elements: OverlayElement[]): ProcedureLayoutStructure {
  const structure = structureSchema.parse(raw);
  const byId = new Map(elements.map((element) => [element.id, element]));
  if (byId.size !== elements.length) throw new Error('Repeated input element identity');
  const used = new Set<string>();
  const take = (id: string, kind: 'TEXT' | 'IMAGE') => {
    if (!byId.has(id) || byId.get(id)?.kind !== kind || used.has(id)) {
      throw new Error('Unknown, repeated or incorrectly typed layout element');
    }
    used.add(id);
  };
  if (structure.titleId !== null) take(structure.titleId, 'TEXT');
  for (const step of structure.steps) {
    if (step.textId === null && step.photoIds.length === 0) throw new Error('Empty layout step');
    if (step.textId !== null) take(step.textId, 'TEXT');
    step.photoIds.forEach((id) => take(id, 'IMAGE'));
  }
  structure.noteIds.forEach((id) => take(id, 'TEXT'));
  if (elements.some((element) => element.kind !== 'SHAPE' && !used.has(element.id))) {
    throw new Error('Unclassified layout element');
  }
  return structure;
}

export class ProcedureLayoutError extends Error {}

const MARGIN = 0.04;
const GAP = 0.02;
const WIDTH = 1 - MARGIN * 2;

/** Font size is page-width-relative (OverlayLayer's cqw); Japanese glyphs use
 * roughly one em, and the editor's default line height is 1.5. Counting every
 * glyph as one em is conservative for Latin text. Explicit newlines each start
 * a line, with one extra em of width reserved for rounding/word wrapping. */
function textHeight(element: OverlayTextElement, width: number, font: number, pageAspect: number): number {
  const perLine = Math.max(1, Math.floor(width / Math.max(0.005, font)) - 1);
  const lines = element.text.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(Array.from(line).length / perLine)), 0);
  return lines * Math.max(0.005, font) * pageAspect * 1.5;
}

type PhotoEnvelope = { image: OverlayImageElement; left: number; top: number; right: number; bottom: number; aspect: number };

/** Pure page layout: only geometry, step font sizes and necessary shape stacking change. */
export function arrangeProcedureLayout(params: {
  structure: ProcedureLayoutStructure;
  elements: OverlayElement[];
  page: { width: number; height: number };
  imageAspectRatios: Record<string, number>;
  key: 'standard' | 'largePhoto';
}): OverlayElement[] {
  const { elements, page, imageAspectRatios, key } = params;
  const structure = validateProcedureLayoutStructure(params.structure, elements);
  if (!(page.width > 0 && page.height > 0 && Number.isFinite(page.width / page.height))) {
    throw new ProcedureLayoutError('Invalid page dimensions');
  }
  const pageAspect = page.width / page.height;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const images = elements.filter((element): element is OverlayImageElement => element.kind === 'IMAGE');
  const owners = new Map<string, string>();
  const envelopes = new Map<string, PhotoEnvelope>();
  for (const image of images) {
    const aspect = imageAspectRatios[image.assetId];
    if (!(aspect > 0 && Number.isFinite(aspect))) throw new ProcedureLayoutError('Invalid image dimensions');
    envelopes.set(image.id, { image, left: 0, top: 0, right: 1, bottom: 1, aspect: aspect / pageAspect });
  }
  // Overlapping photos: the topmost photo owns the shape; id breaks z-index ties.
  const topFirst = [...images].sort((a, b) => b.zIndex - a.zIndex || a.id.localeCompare(b.id));
  for (const element of elements) {
    if (element.kind !== 'SHAPE') continue;
    const box = element.bbox;
    const center = { x: box.xRatio + box.widthRatio / 2, y: box.yRatio + box.heightRatio / 2 };
    const owner = topFirst.find(({ bbox: b }) => center.x >= b.xRatio && center.x <= b.xRatio + b.widthRatio && center.y >= b.yRatio && center.y <= b.yRatio + b.heightRatio);
    if (!owner) continue;
    owners.set(element.id, owner.id);
    const envelope = envelopes.get(owner.id)!;
    const points = [
      { xRatio: box.xRatio, yRatio: box.yRatio },
      { xRatio: box.xRatio + box.widthRatio, yRatio: box.yRatio + box.heightRatio },
      ...(element.start ? [element.start] : []), ...(element.end ? [element.end] : [])
    ];
    for (const point of points) {
      const x = (point.xRatio - owner.bbox.xRatio) / owner.bbox.widthRatio;
      const y = (point.yRatio - owner.bbox.yRatio) / owner.bbox.heightRatio;
      envelope.left = Math.min(envelope.left, x); envelope.right = Math.max(envelope.right, x);
      envelope.top = Math.min(envelope.top, y); envelope.bottom = Math.max(envelope.bottom, y);
    }
  }
  const stepTexts = structure.steps.flatMap(({ textId }) => textId === null ? [] : [byId.get(textId) as OverlayTextElement]);
  const fonts = stepTexts.map((text) => text.style?.fontSizeRatio ?? 0.025).sort((a, b) => a - b);
  const stepFont = Math.max(0.005, fonts[Math.floor(fonts.length / 2)] ?? 0.025);
  const photoColumn = WIDTH * (key === 'standard' ? 0.37 : 0.5);
  const textLeft = MARGIN + photoColumn + GAP;
  const textWidth = WIDTH - photoColumn - GAP;
  const rows = structure.steps.map((step) => {
    const text = step.textId === null ? null : byId.get(step.textId) as OverlayTextElement;
    const photos = step.photoIds.map((id) => envelopes.get(id)!);
    const photoGap = Math.min(GAP, photoColumn / Math.max(1, photos.length) / 3);
    const slotWidth = photos.length ? (photoColumn - photoGap * (photos.length - 1)) / photos.length : photoColumn;
    const height = text ? textHeight(text, photos.length ? textWidth : WIDTH, stepFont, pageAspect) : 0;
    const photoHeights = photos.map((photo) => slotWidth / (photo.right - photo.left) / photo.aspect * (photo.bottom - photo.top));
    return { text, photos, slotWidth, photoGap, textHeight: height, photoHeights };
  });
  const title = structure.titleId === null ? null : byId.get(structure.titleId) as OverlayTextElement;
  const titleFont = title ? Math.max(stepFont, title.style?.fontSizeRatio ?? 0.025) : 0;
  const titleHeight = title ? textHeight(title, WIDTH, titleFont, pageAspect) : 0;
  const notes = structure.noteIds.map((id) => byId.get(id) as OverlayTextElement);
  const noteHeights = notes.map((note) => textHeight(note, WIDTH, note.style?.fontSizeRatio ?? 0.025, pageAspect));
  const blockCount = (title ? 1 : 0) + rows.length + notes.length;
  const fixedHeight = titleHeight + noteHeights.reduce((sum, height) => sum + height, 0) + GAP * Math.max(0, blockCount - 1);
  // First reduce photos only. Text never shrinks to hide an overflow. A positive
  // photo-only row can use the remaining space down to numerical precision.
  const totalHeight = (scale: number) => fixedHeight + rows.reduce((sum, row) => sum + Math.max(row.textHeight, ...row.photoHeights.map((height) => height * scale), 0), 0);
  if (totalHeight(0) > 1 - MARGIN * 2) throw new ProcedureLayoutError('Text does not fit on one page');
  let photoScale = 1;
  if (totalHeight(1) > 1 - MARGIN * 2) {
    let low = 0; let high = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (totalHeight(mid) <= 1 - MARGIN * 2 - 1e-10) low = mid; else high = mid;
    }
    photoScale = low;
    if (photoScale <= 0) throw new ProcedureLayoutError('Text leaves no space for photos');
  }
  const placed = new Map<string, OverlayElement>();
  let y = MARGIN;
  const placeText = (text: OverlayTextElement, x: number, width: number, height: number, font?: number) => {
    placed.set(text.id, { ...text, bbox: { xRatio: x, yRatio: y, widthRatio: width, heightRatio: height }, ...(font === undefined ? {} : { style: { ...text.style, fontSizeRatio: font } }) });
  };
  if (title) { placeText(title, MARGIN, WIDTH, titleHeight, titleFont); y += titleHeight + GAP; }
  for (const row of rows) {
    const rowHeight = Math.max(row.textHeight, ...row.photoHeights.map((height) => height * photoScale), 0);
    row.photos.forEach((photo, i) => {
      const envelopeHeight = row.photoHeights[i] * photoScale;
      const height = envelopeHeight / (photo.bottom - photo.top);
      const width = height * photo.aspect;
      const envelopeWidth = width * (photo.right - photo.left);
      placed.set(photo.image.id, { ...photo.image, bbox: {
        xRatio: MARGIN + i * (row.slotWidth + row.photoGap) + (row.slotWidth - envelopeWidth) / 2 - photo.left * width,
        yRatio: y - photo.top * height,
        widthRatio: width, heightRatio: height
      } });
    });
    if (row.text) placeText(row.text, row.photos.length ? textLeft : MARGIN, row.photos.length ? textWidth : WIDTH, row.textHeight, stepFont);
    y += rowHeight + GAP;
  }
  notes.forEach((note, index) => { placeText(note, MARGIN, WIDTH, noteHeights[index]); y += noteHeights[index] + GAP; });
  const result = elements.map((element): OverlayElement => {
    if (element.kind !== 'SHAPE') return placed.get(element.id)!;
    const ownerId = owners.get(element.id);
    if (!ownerId) return element;
    const oldBox = byId.get(ownerId)!.bbox;
    const target = placed.get(ownerId)!;
    const newBox = target.bbox;
    const scaleX = newBox.widthRatio / oldBox.widthRatio;
    const scaleY = newBox.heightRatio / oldBox.heightRatio;
    const transformPoint = (point: { xRatio: number; yRatio: number }) => ({
      xRatio: newBox.xRatio + (point.xRatio - oldBox.xRatio) * scaleX,
      yRatio: newBox.yRatio + (point.yRatio - oldBox.yRatio) * scaleY
    });
    const bbox: OverlayBBox = { ...transformPoint(element.bbox), widthRatio: element.bbox.widthRatio * scaleX, heightRatio: element.bbox.heightRatio * scaleY };
    return { ...element, bbox, zIndex: Math.max(element.zIndex, target.zIndex + 1),
      ...(element.start ? { start: transformPoint(element.start) } : {}),
      ...(element.end ? { end: transformPoint(element.end) } : {}) };
  });
  // Validate without replacing the objects: zod defaults/trim must not alter
  // appearance or text content in the user's draft.
  for (const element of result) overlayElementSchema.parse(element);
  return result;
}
