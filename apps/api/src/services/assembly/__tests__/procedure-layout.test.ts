import { describe, expect, it } from 'vitest';
import { overlayElementSchema, type OverlayElement, type OverlayTextElement, type OverlayImageElement, type OverlayShapeElement } from '@raspi-system/shared-types';

import { arrangeProcedureLayout, ProcedureLayoutError, validateProcedureLayoutStructure, type ProcedureLayoutStructure } from '../procedure-layout.js';

const box = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 };
const text = (id: string, body = '手順を実行してください', font = 0.025): OverlayTextElement => ({ id, kind: 'TEXT', pageIndex: 0, text: body, bbox: { ...box }, zIndex: 2, style: { fontSizeRatio: font, fontWeight: 'bold', color: '#334455', align: 'start' }, opacity: 0.8 });
const photo = (id: string): OverlayImageElement => ({ id, kind: 'IMAGE', assetId: `asset-${id}`, pageIndex: 0, bbox: { ...box }, zIndex: 1, objectFit: 'cover', mask: { enabled: true, color: '#ffffff' } });
const shape = (id: string): OverlayShapeElement => ({ id, kind: 'SHAPE', pageIndex: 0, bbox: { xRatio: 0.15, yRatio: 0.15, widthRatio: 0.1, heightRatio: 0.05 }, shape: 'ARROW', start: { xRatio: 0.15, yRatio: 0.15 }, end: { xRatio: 0.25, yRatio: 0.2 }, zIndex: 3, strokeColor: '#ff0000', strokeWidthRatio: 0.003 });
const basic: ProcedureLayoutStructure = { titleId: null, steps: [{ textId: 't1', photoIds: ['p1'] }, { textId: 't2', photoIds: ['p2'] }], noteIds: [] };
const run = (elements: OverlayElement[], structure = basic, options: { key?: 'standard' | 'largePhoto'; page?: { width: number; height: number }; ratios?: Record<string, number> } = {}) => arrangeProcedureLayout({ elements, structure, page: options.page ?? { width: 1000, height: 1400 }, imageAspectRatios: options.ratios ?? Object.fromEntries(elements.filter((e) => e.kind === 'IMAGE').map((e) => [(e as OverlayImageElement).assetId, 4 / 3])), key: options.key ?? 'standard' });
const get = (elements: OverlayElement[], id: string) => elements.find((e) => e.id === id)!;

describe('procedure layout geometry', () => {
  it('aligns photo columns/text starts and uses equal row gaps in both plans', () => {
    const input = [text('title', '題名', 0.05), text('t1', '1 作業', 0.02), photo('p1'), text('t2', '2 作業', 0.03), photo('p2'), text('note', '注意')];
    const structure = { ...basic, titleId: 'title', noteIds: ['note'] };
    for (const key of ['standard', 'largePhoto'] as const) {
      const output = run(input, structure, { key });
      expect(get(output, 'p1').bbox.widthRatio).toBeCloseTo(0.92 * (key === 'standard' ? 0.37 : 0.5));
      expect(get(output, 'p1').bbox.xRatio).toBeCloseTo(get(output, 'p2').bbox.xRatio);
      expect(get(output, 'p1').bbox.widthRatio).toBeCloseTo(get(output, 'p2').bbox.widthRatio);
      expect(get(output, 't1').bbox.xRatio).toBe(get(output, 't2').bbox.xRatio);
      expect((get(output, 't1') as OverlayTextElement).style?.fontSizeRatio).toBe((get(output, 't2') as OverlayTextElement).style?.fontSizeRatio);
      expect((get(output, 'title') as OverlayTextElement).style?.fontSizeRatio).toBe(0.05);
      const p1 = get(output, 'p1').bbox; const p2 = get(output, 'p2').bbox;
      expect(p2.yRatio - p1.yRatio - p1.heightRatio).toBeCloseTo(0.02);
      expect(get(output, 'note').bbox.yRatio - p2.yRatio - p2.heightRatio).toBeCloseTo(0.02);
      output.forEach((element) => expect(overlayElementSchema.safeParse(element).success).toBe(true));
    }
  });
  it('preserves physical image aspect ratios on a non-square page', () => {
    const input = [text('t1'), photo('p1'), text('t2'), photo('p2')];
    const output = run(input, basic, { ratios: { 'asset-p1': 2, 'asset-p2': 0.5 } });
    for (const [id, aspect] of [['p1', 2], ['p2', 0.5]] as const) {
      const b = get(output, id).bbox;
      expect(b.widthRatio * 1000 / (b.heightRatio * 1400)).toBeCloseTo(aspect);
    }
  });
  it('shrinks photos first so every row fits without reducing the text font', () => {
    const input = [text('t1'), photo('p1'), text('t2'), photo('p2')];
    const output = run(input, basic, { ratios: { 'asset-p1': 0.1, 'asset-p2': 0.1 } });
    expect(get(output, 'p1').bbox.widthRatio).toBeLessThan(0.92 * 0.37);
    for (const element of output) {
      expect(element.bbox.yRatio + element.bbox.heightRatio).toBeLessThanOrEqual(0.96);
      if (element.kind === 'TEXT') expect(element.style?.fontSizeRatio).toBe(0.025);
    }
  });
  it('rejects a page where text alone cannot fit', () => {
    expect(() => run([text('t1', '長'.repeat(10000)), photo('p1'), text('t2'), photo('p2')])).toThrow(ProcedureLayoutError);
  });
  it('moves attached shapes/endpoints by the photo affine transform and leaves other shapes untouched', () => {
    const attached = shape('arrow');
    const unattached = { ...shape('free'), bbox: { xRatio: 0.8, yRatio: 0.8, widthRatio: 0.1, heightRatio: 0.05 } };
    const input = [text('t1'), photo('p1'), text('t2'), { ...photo('p2'), bbox: { ...box, yRatio: 0.5 } }, attached, unattached];
    const output = run(input);
    const p = get(output, 'p1').bbox;
    const moved = get(output, 'arrow') as OverlayShapeElement;
    expect(moved.bbox.xRatio).toBeCloseTo(p.xRatio + (attached.bbox.xRatio - box.xRatio) * p.widthRatio / box.widthRatio);
    expect(moved.bbox.heightRatio).toBeCloseTo(attached.bbox.heightRatio * p.heightRatio / box.heightRatio);
    expect(moved.start?.xRatio).toBeCloseTo(moved.bbox.xRatio);
    expect(moved.end?.yRatio).toBeCloseTo(p.yRatio + (attached.end!.yRatio - box.yRatio) * p.heightRatio / box.heightRatio);
    expect(get(output, 'free')).toEqual(unattached);
  });
  it('reserves space for shapes extending beyond their photo without clipping them', () => {
    const attached = { ...shape('arrow'), bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.6, heightRatio: 0.4 }, start: { xRatio: 0, yRatio: 0 }, end: { xRatio: 0.6, yRatio: 0.4 } };
    const output = run([text('t1'), photo('p1'), text('t2'), { ...photo('p2'), bbox: { ...box, yRatio: 0.5 } }, attached]);
    output.forEach((element) => expect(overlayElementSchema.safeParse(element).success).toBe(true));
    expect(get(output, 'arrow').bbox.xRatio).toBeGreaterThanOrEqual(0.04 - 1e-10);
  });
  it('preserves all identities, text, assets, appearance, page index and input objects', () => {
    const input = [text('t1', '  1 文\n'), photo('p1'), text('t2'), photo('p2'), shape('arrow')];
    const copy = structuredClone(input);
    const output = run(input);
    expect(input).toEqual(copy);
    expect(output.map((e) => e.id)).toEqual(input.map((e) => e.id));
    output.forEach((element, index) => {
      const { bbox: oldBox, ...original } = input[index];
      const { bbox: newBox, ...changed } = element;
      if (element.kind === 'SHAPE') {
        const { start, end, ...rest } = changed as OverlayShapeElement;
        const { start: oldStart, end: oldEnd, ...oldRest } = original as OverlayShapeElement;
        expect(rest).toEqual(oldRest);
      } else expect(changed).toEqual(original);
    });
  });
  it('handles text-only steps, photo-only rows and several photos within the left column', () => {
    const structure = { titleId: null, steps: [{ textId: 't1', photoIds: [] }, { textId: null, photoIds: ['p1'] }, { textId: 't2', photoIds: ['p2', 'p3'] }], noteIds: [] };
    const output = run([text('t1'), photo('p1'), text('t2'), photo('p2'), photo('p3')], structure);
    expect(get(output, 't1').bbox.widthRatio).toBeCloseTo(0.92);
    const p2 = get(output, 'p2').bbox; const p3 = get(output, 'p3').bbox;
    expect(p2.yRatio).toBe(p3.yRatio);
    expect(p3.xRatio).toBeGreaterThan(p2.xRatio + p2.widthRatio);
    expect(p3.xRatio + p3.widthRatio).toBeLessThan(get(output, 't2').bbox.xRatio);
  });
  it('raises a smaller title to the common step font while preserving notes', () => {
    const output = run([text('title', '題名', 0.01), text('t1'), photo('p1'), text('t2'), photo('p2'), text('note', '注', 0.035)], { ...basic, titleId: 'title', noteIds: ['note'] });
    expect((get(output, 'title') as OverlayTextElement).style?.fontSizeRatio).toBe(0.025);
    expect((get(output, 'note') as OverlayTextElement).style?.fontSizeRatio).toBe(0.035);
  });
});

describe('structure validation', () => {
  const elements = [text('t1'), photo('p1'), text('t2'), photo('p2')];
  it('accepts a complete structure', () => expect(validateProcedureLayoutStructure(basic, elements)).toEqual(basic));
  it.each([
    { ...basic, titleId: 'unknown' },
    { ...basic, noteIds: ['t1'] },
    { ...basic, titleId: 'p1' },
    { ...basic, steps: [{ textId: 'p1', photoIds: ['t1'] }, basic.steps[1]] },
    { ...basic, steps: [basic.steps[0]] },
    { ...basic, steps: [{ textId: 't1', photoIds: ['p1', 'p1'] }, basic.steps[1]] },
    { ...basic, steps: [...basic.steps, { textId: null, photoIds: [] }] }
  ])('rejects unknown/duplicate/wrong-kind/missing IDs and empty rows (%j)', (structure) => {
    expect(() => validateProcedureLayoutStructure(structure, elements)).toThrow();
  });
});
