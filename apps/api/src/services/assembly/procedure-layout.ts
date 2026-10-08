import { overlayElementSchema, type OverlayBBox, type OverlayElement, type OverlayImageElement, type OverlayTextElement } from '@raspi-system/shared-types';
import { z } from 'zod';

export class ProcedureLayoutError extends Error {}
export type ProcedureLayoutRow = { imageId: string; textIds: string[] };
const MARGIN = 0.04;
const PHOTO_GAP = 0.03;
const TEXT_GAP = 0.008;
const MIN_ROW_GAP = 0.01;
const MAX_ROW_GAP = 0.035;
const EPSILON = 1e-9;
const fontSize = (text: OverlayTextElement) => Math.max(0.005, text.style?.fontSizeRatio ?? 0.025);
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2 : 0.025;
}

/** OverlayLayer uses page-width-relative cqw and inherited line-height 1.5.
 * Reserve one em and 8% extra width for wrapping/rounding; ASCII is about .55 em. */
export function estimateProcedureTextHeight(text: OverlayTextElement, width: number, page: { width: number; height: number }, font = fontSize(text)): number {
  const capacity = Math.max(0.5, width / font - 1);
  const lines = text.text.split('\n').reduce((sum, line) => {
    const units = Array.from(line).reduce((count, char) => count + ((char.codePointAt(0)! <= 0x7f || /[\uff61-\uff9f]/u.test(char)) ? 0.55 : 1), 0);
    return sum + Math.max(1, Math.ceil(units * 1.08 / capacity));
  }, 0);
  // Include half an em for OverlayLayer's p-0.5 inset.
  return (lines * 1.5 + 0.5) * font * (page.width / page.height);
}

/** Assign using the occupied text height, before editing or moving anything. */
export function assignProcedureLayoutRows(elements: OverlayElement[], page: { width: number; height: number }): ProcedureLayoutRow[] | null {
  const images = elements.filter((element): element is OverlayImageElement => element.kind === 'IMAGE').sort((a, b) => a.bbox.yRatio - b.bbox.yRatio);
  if (!images.length) return null;
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i].bbox; const b = images[j].bbox;
      const horizontal = Math.min(a.xRatio + a.widthRatio, b.xRatio + b.widthRatio) - Math.max(a.xRatio, b.xRatio);
      const vertical = Math.min(a.yRatio + a.heightRatio, b.yRatio + b.heightRatio) - Math.max(a.yRatio, b.yRatio);
      if (horizontal <= 0 || vertical > Math.min(a.heightRatio, b.heightRatio) * 0.2 + EPSILON) return null;
    }
  }
  const rows = images.map(image => ({ imageId: image.id, textIds: [] as string[] }));
  const texts = elements.filter((element): element is OverlayTextElement => element.kind === 'TEXT').sort((a, b) => a.bbox.yRatio - b.bbox.yRatio);
  for (const text of texts) {
    const center = text.bbox.yRatio + Math.min(text.bbox.heightRatio, estimateProcedureTextHeight(text, text.bbox.widthRatio, page)) / 2;
    const distance = (image: OverlayImageElement) => center < image.bbox.yRatio ? image.bbox.yRatio - center : Math.max(0, center - image.bbox.yRatio - image.bbox.heightRatio) * 2;
    let nearest = 0;
    for (let i = 1; i < images.length; i++) if (distance(images[i]) < distance(images[nearest])) nearest = i;
    rows[nearest].textIds.push(text.id);
  }
  return rows;
}

function numbers(text: string): string[] {
  return text.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/^[^\S\n]*\d+[.．](?!\d)/gm, '').match(/\d+/g)?.sort() ?? [];
}
export function isValidProcedureTextRewrite(original: string, rewritten: string): boolean {
  return rewritten.trim().length > 0 && rewritten.length <= Math.min(10_000, original.length * 2 + 20)
    && JSON.stringify(numbers(original)) === JSON.stringify(numbers(rewritten));
}

/** An invalid element never invalidates good siblings. Duplicate IDs are ambiguous. */
export function rewriteProcedureTexts(elements: OverlayElement[], raw: unknown): OverlayElement[] {
  const response = z.object({ texts: z.array(z.unknown()) }).parse(raw);
  const entrySchema = z.object({ id: z.string(), text: z.string() });
  const entries = response.texts.flatMap(value => {
    const parsed = entrySchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  return elements.map(element => {
    if (element.kind !== 'TEXT') return element;
    const matches = entries.filter(entry => entry.id === element.id);
    return matches.length === 1 && isValidProcedureTextRewrite(element.text, matches[0].text) && matches[0].text !== element.text
      ? { ...element, text: matches[0].text } : element;
  });
}

const sameBox = (a: OverlayBBox, b: OverlayBBox) => (Object.keys(a) as (keyof OverlayBBox)[]).every(key => Math.abs(a[key] - b[key]) < EPSILON);
const overlaps = (a: OverlayBBox, b: OverlayBBox) => Math.min(a.xRatio + a.widthRatio, b.xRatio + b.widthRatio) > Math.max(a.xRatio, b.xRatio) + EPSILON
  && Math.min(a.yRatio + a.heightRatio, b.yRatio + b.heightRatio) > Math.max(a.yRatio, b.yRatio) + EPSILON;

/** Repair the existing photo column. Photos are translated, never resized. */
export function arrangeProcedureLayout(params: {
  elements: OverlayElement[];
  page: { width: number; height: number };
  rows?: ProcedureLayoutRow[] | null;
  originalElements?: OverlayElement[];
}): { elements: OverlayElement[]; changes: string[] } {
  const { elements, page } = params;
  if (!(page.width > 0 && page.height > 0 && Number.isFinite(page.width / page.height))) throw new ProcedureLayoutError('Invalid page dimensions');
  const rows = params.rows === undefined ? assignProcedureLayoutRows(elements, page) : params.rows;
  const original = new Map((params.originalElements ?? elements).map(element => [element.id, element]));
  if (!rows) {
    const result = elements.map(element => {
      const before = original.get(element.id);
      if (element.kind !== 'TEXT' || before?.kind !== 'TEXT') return element;
      const estimated = estimateProcedureTextHeight(element, element.bbox.widthRatio, page);
      if (estimated <= estimateProcedureTextHeight(before, before.bbox.widthRatio, page) + EPSILON || estimated <= element.bbox.heightRatio) return element;
      return { ...element, bbox: { ...element.bbox, heightRatio: Math.min(estimated, 1 - element.bbox.yRatio) } };
    });
    const changes = ['配置はそのまま(写真が縦 1 列でないため)'];
    if (result.some((element, i) => element !== elements[i])) changes.push('文章の箱を改行に合わせて広げた');
    return { elements: result, changes };
  }
  const byId = new Map(elements.map(element => [element.id, element]));
  const photos = rows.map(row => byId.get(row.imageId) as OverlayImageElement);
  const maxWidth = Math.max(...photos.map(photo => photo.bbox.widthRatio));
  const mirrored = median(photos.map(photo => photo.bbox.xRatio + photo.bbox.widthRatio / 2)) > 0.5;
  const low = mirrored ? MARGIN + 0.3 + PHOTO_GAP : MARGIN;
  const high = mirrored ? 1 - MARGIN - maxWidth : 1 - MARGIN - maxWidth - PHOTO_GAP - 0.3;
  if (high < low - EPSILON) throw new ProcedureLayoutError('No room for text column');
  const photoX = Math.max(low, Math.min(high, median(photos.map(photo => photo.bbox.xRatio))));
  const textX = mirrored ? MARGIN : photoX + maxWidth + PHOTO_GAP;
  const textWidth = mirrored ? photoX - PHOTO_GAP - MARGIN : 1 - MARGIN - textX;
  let scale = 1;
  const measureRows = (factor: number) => rows.map((row, index) => {
    const texts = row.textIds.map(id => byId.get(id) as OverlayTextElement);
    const heights = texts.map(text => estimateProcedureTextHeight(text, textWidth, page, Math.max(0.005, fontSize(text) * factor)));
    return { texts, heights, height: Math.max(photos[index].bbox.heightRatio, heights.reduce((sum, height) => sum + height, 0) + TEXT_GAP * Math.max(0, texts.length - 1)) };
  });
  let measured = measureRows(scale);
  const total = () => measured.reduce((sum, row) => sum + row.height, 0);
  const available = 1 - MARGIN * 2;
  for (const factor of [0.96, 0.92, 0.88, 0.84, 0.8]) {
    if (total() + MIN_ROW_GAP * (rows.length - 1) <= available + EPSILON) break;
    scale = factor; measured = measureRows(scale);
  }
  if (total() + MIN_ROW_GAP * (rows.length - 1) > available + EPSILON) throw new ProcedureLayoutError('Page does not fit');
  const gap = rows.length > 1 ? Math.min(MAX_ROW_GAP, (available - total()) / (rows.length - 1)) : 0;
  const placed = new Map<string, OverlayElement>();
  let y = MARGIN;
  measured.forEach((row, index) => {
    const photo = photos[index];
    const bbox = { ...photo.bbox, xRatio: photoX, yRatio: y };
    placed.set(photo.id, sameBox(photo.bbox, bbox) ? photo : { ...photo, bbox });
    let textY = y;
    row.texts.forEach((text, i) => {
      const textBox = { xRatio: textX, yRatio: textY, widthRatio: textWidth, heightRatio: row.heights[i] };
      placed.set(text.id, sameBox(text.bbox, textBox) && scale === 1 ? text : { ...text, bbox: textBox,
        ...(scale === 1 ? {} : { style: { ...text.style, fontSizeRatio: (text.style?.fontSizeRatio ?? 0.025) * scale } }) });
      textY += row.heights[i] + TEXT_GAP;
    });
    y += row.height + gap;
  });
  const topFirst = [...photos].sort((a, b) => b.zIndex - a.zIndex || a.id.localeCompare(b.id));
  const result = elements.map(element => {
    if (element.kind !== 'SHAPE') return placed.get(element.id)!;
    const b = element.bbox;
    const cx = b.xRatio + b.widthRatio / 2; const cy = b.yRatio + b.heightRatio / 2;
    const owner = topFirst.find(({ bbox: p }) => cx >= p.xRatio && cx <= p.xRatio + p.widthRatio && cy >= p.yRatio && cy <= p.yRatio + p.heightRatio);
    if (!owner) return element;
    const target = placed.get(owner.id)!;
    const dx = target.bbox.xRatio - owner.bbox.xRatio; const dy = target.bbox.yRatio - owner.bbox.yRatio;
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return element;
    const move = (point: { xRatio: number; yRatio: number }) => ({ xRatio: point.xRatio + dx, yRatio: point.yRatio + dy });
    return { ...element, bbox: { ...b, ...move(b) }, ...(element.start ? { start: move(element.start) } : {}), ...(element.end ? { end: move(element.end) } : {}) };
  });
  if (result.some(element => !overlayElementSchema.safeParse(element).success)) throw new ProcedureLayoutError('Element leaves page');
  const changes: string[] = [];
  const next = new Map(result.map(element => [element.id, element]));
  if (photos.some(photo => Math.abs(photo.bbox.xRatio - photoX) > EPSILON)) {
    const aligned = photos.every(photo => Math.abs(photo.bbox.xRatio - photos[0].bbox.xRatio) < EPSILON);
    changes.push(aligned ? '写真を余白の内側に入れた' : `写真 ${photos.length} 枚の${mirrored ? '右側の列' : '左端'}をそろえた`);
  }
  const texts = [...original.values()].filter((element): element is OverlayTextElement => element.kind === 'TEXT');
  const overflowing = texts.filter(text => text.bbox.xRatio + text.bbox.widthRatio > 1 || text.bbox.yRatio + text.bbox.heightRatio > 1).length;
  if (overflowing) changes.push(`紙からはみ出した文章 ${overflowing} 個を内側に入れた`);
  let separated = 0;
  texts.forEach((text, i) => texts.slice(i + 1).forEach(other => {
    if (overlaps(text.bbox, other.bbox) && !overlaps(next.get(text.id)!.bbox, next.get(other.id)!.bbox)) separated++;
  }));
  if (separated) changes.push(`重なった文章 ${separated} 組を離した`);
  if (texts.some(text => !sameBox(text.bbox, next.get(text.id)!.bbox))) changes.push(`文章を写真の${mirrored ? '左' : '右'}にそろえた`);
  if (photos.some(photo => Math.abs(photo.bbox.yRatio - next.get(photo.id)!.bbox.yRatio) > EPSILON)) {
    const spacingChanged = photos.slice(1).some((photo, i) => Math.abs((photo.bbox.yRatio - photos[i].bbox.yRatio) - (next.get(photo.id)!.bbox.yRatio - next.get(photos[i].id)!.bbox.yRatio)) > EPSILON);
    changes.push(spacingChanged ? '写真と文章の行間を整えた' : '写真を上余白にそろえた');
  }
  if (scale < 1) changes.push(`文字を ${Math.round(scale * 100)}% にした(写真の大きさはそのまま)`);
  if (!changes.length && result.some(element => element !== byId.get(element.id))) changes.push('写真に付いた図形をそろえた');
  return { elements: result, changes };
}
