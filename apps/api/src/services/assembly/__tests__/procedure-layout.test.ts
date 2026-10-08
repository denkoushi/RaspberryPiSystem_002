import { describe, expect, it } from 'vitest';
import { overlayElementSchema, type OverlayElement, type OverlayTextElement, type OverlayImageElement, type OverlayShapeElement } from '@raspi-system/shared-types';

import { arrangeProcedureLayout, assignProcedureLayoutRows, estimateProcedureTextHeight, isValidProcedureTextRewrite, ProcedureLayoutError, rewriteProcedureTexts } from '../procedure-layout.js';

const page = { width: 1000, height: 1400 };
const text = (id: string, y = 0.1, body = '架空ワークを固定する', font = 0.025): OverlayTextElement => ({ id, kind: 'TEXT', pageIndex: 0, text: body, bbox: { xRatio: 0.7, yRatio: y, widthRatio: 0.3, heightRatio: 0.15 }, zIndex: 2, style: { fontSizeRatio: font, color: '#334455' } });
const photo = (id: string, y = 0.1, x = 0.04): OverlayImageElement => ({ id, kind: 'IMAGE', assetId: `asset-${id}`, pageIndex: 0, bbox: { xRatio: x, yRatio: y, widthRatio: 0.3, heightRatio: 0.18 }, zIndex: 1, objectFit: 'cover' });
const run = (elements: OverlayElement[]) => arrangeProcedureLayout({ elements, page });
const get = (elements: OverlayElement[], id: string) => elements.find(element => element.id === id)!;
function expectPhotosUnchanged(input: OverlayElement[], output: OverlayElement[]) {
  for (const image of input.filter(element => element.kind === 'IMAGE')) {
    expect(get(output, image.id).bbox.widthRatio).toBe(image.bbox.widthRatio);
    expect(get(output, image.id).bbox.heightRatio).toBe(image.bbox.heightRatio);
    expect(get(output, image.id)).toMatchObject({ assetId: image.kind === 'IMAGE' ? image.assetId : '', objectFit: 'cover' });
  }
}
function expectFits(elements: OverlayElement[]) {
  elements.forEach(element => expect(overlayElementSchema.safeParse(element).success, element.id).toBe(true));
  const texts = elements.filter(element => element.kind === 'TEXT').sort((a, b) => a.bbox.yRatio - b.bbox.yRatio);
  for (let i = 1; i < texts.length; i++) expect(texts[i - 1].bbox.yRatio + texts[i - 1].bbox.heightRatio).toBeLessThanOrEqual(texts[i].bbox.yRatio);
}

describe('procedure layout geometry', () => {
  it('repairs four slightly displaced left photos without changing their sizes or input objects', () => {
    const input = [0.029, 0.033, 0.033, 0.038].flatMap((x, i) => [photo(`p${i}`, 0.05 + i * 0.22, x), text(`t${i}`, 0.05 + i * 0.22)]);
    const copy = structuredClone(input);
    const result = run(input);
    expectPhotosUnchanged(input, result.elements);
    expectFits(result.elements);
    expect(new Set(result.elements.filter(element => element.kind === 'IMAGE').map(element => element.bbox.xRatio))).toEqual(new Set([0.04]));
    expect(input).toEqual(copy);
    expect(result.changes).toContain('写真 4 枚の左端をそろえた');
  });
  it('repairs overflowing, overlapping default .3 by .15 text boxes', () => {
    const first = text('a'); const second = text('b', 0.11);
    first.bbox.xRatio = 0.705; second.bbox.xRatio = 0.705;
    const result = run([photo('p'), first, second]);
    expectFits(result.elements);
    expect(result.changes).toContain('紙からはみ出した文章 2 個を内側に入れた');
    expect(result.changes).toContain('重なった文章 1 組を離した');
  });
  it('assigns a short heading above the next photo using occupied height rather than its tall box', () => {
    const input = [photo('p1', 0.04), photo('p2', 0.31), text('heading', 0.265, '架空の工程')];
    expect(assignProcedureLayoutRows(input, page)).toEqual([{ imageId: 'p1', textIds: [] }, { imageId: 'p2', textIds: ['heading'] }]);
  });
  it('reduces all fonts together down to .8 and fails rather than shrinking photos', () => {
    const input = [photo('p1', 0.04), text('t1', 0.04, Array(33).fill('架空の固定作業').join('\n')), photo('p2', 0.5), text('t2', 0.5, '架空の確認作業', 0.03)];
    const result = run(input);
    expectPhotosUnchanged(input, result.elements); expectFits(result.elements);
    const reduced = get(result.elements, 't1') as OverlayTextElement;
    const factor = reduced.style!.fontSizeRatio! / 0.025;
    expect(factor).toBeLessThan(1); expect(factor).toBeGreaterThanOrEqual(0.8);
    expect((get(result.elements, 't2') as OverlayTextElement).style!.fontSizeRatio).toBeCloseTo(0.03 * factor);
    expect(result.changes.some(change => change.includes('写真の大きさはそのまま'))).toBe(true);
    expect(() => run([photo('p1'), text('t1', 0.1, '架'.repeat(10000))])).toThrow(ProcedureLayoutError);
  });
  it('keeps a horizontal pair and a text-only page in their original positions', () => {
    for (const input of [[photo('a'), photo('b', 0.1, 0.6), text('t')], [text('a'), text('b', 0.4)]]) {
      expect(assignProcedureLayoutRows(input, page)).toBeNull();
      expect(run(input).elements).toEqual(input);
    }
  });
  it('does nothing to an already repaired page', () => {
    const input = run([photo('p'), text('t')]).elements;
    const result = run(input);
    expect(result.elements).toEqual(input); expect(result.changes).toEqual([]);
    expect(result.elements.every((element, i) => element === input[i])).toBe(true);
  });
  it('mirrors the columns when photos are on the right, including unequal widths', () => {
    const input = [photo('a', 0.04, 0.62), photo('b', 0.4, 0.63), text('t', 0.04)];
    input[1].bbox.widthRatio = 0.32;
    const result = run(input);
    expectPhotosUnchanged(input, result.elements); expectFits(result.elements);
    expect(get(result.elements, 't').bbox.xRatio).toBe(0.04);
    expect(get(result.elements, 't').bbox.xRatio + get(result.elements, 't').bbox.widthRatio).toBeLessThan(get(result.elements, 'a').bbox.xRatio);
    expect(get(result.elements, 'a').bbox.xRatio).toBe(get(result.elements, 'b').bbox.xRatio);
  });
  it('rejects photo columns with excessive vertical overlap or insufficient text width', () => {
    expect(assignProcedureLayoutRows([photo('a'), photo('b', 0.2)], page)).toBeNull();
    expect(assignProcedureLayoutRows([photo('a'), photo('b', 0.244)], page)).not.toBeNull();
    const wide = photo('wide'); wide.bbox.widthRatio = 0.7;
    expect(() => run([wide, text('t')])).toThrow(ProcedureLayoutError);
  });
  it('translates attached shapes and endpoints, preserving sizes and unattached shapes', () => {
    const attached: OverlayShapeElement = { id: 'arrow', kind: 'SHAPE', shape: 'ARROW', pageIndex: 0, zIndex: 3, bbox: { xRatio: 0.1, yRatio: 0.14, widthRatio: 0.1, heightRatio: 0.04 }, start: { xRatio: 0.1, yRatio: 0.14 }, end: { xRatio: 0.2, yRatio: 0.18 } };
    const free = { ...attached, id: 'free', bbox: { ...attached.bbox, xRatio: 0.8, yRatio: 0.8 } };
    const image = photo('p'); const output = run([image, text('t'), attached, free]).elements;
    const dx = get(output, 'p').bbox.xRatio - image.bbox.xRatio; const dy = get(output, 'p').bbox.yRatio - image.bbox.yRatio;
    const moved = get(output, 'arrow') as OverlayShapeElement;
    expect(moved.bbox).toEqual({ ...attached.bbox, xRatio: attached.bbox.xRatio + dx, yRatio: attached.bbox.yRatio + dy });
    expect(moved.start).toEqual({ xRatio: attached.start!.xRatio + dx, yRatio: attached.start!.yRatio + dy });
    expect(moved.end).toEqual({ xRatio: attached.end!.xRatio + dx, yRatio: attached.end!.yRatio + dy });
    expect(get(output, 'free')).toBe(free);
  });
  it('only grows text height after rewriting wraps to more lines on a non-column page, capped at page bottom', () => {
    const before = text('a', 0.95, '架空の工程'); before.bbox.heightRatio = 0.02;
    const rewritten = { ...before, text: '架空の工程\n架空ワークを確認する\n確認完了' };
    const result = arrangeProcedureLayout({ elements: [rewritten], originalElements: [before], page });
    expect(result.elements[0].bbox).toEqual({ ...before.bbox, heightRatio: 1 - before.bbox.yRatio });
    expect(estimateProcedureTextHeight(before, 0.3, page)).toBeLessThan(estimateProcedureTextHeight(rewritten, 0.3, page));
  });
});

describe('procedure layout text validation', () => {
  it.each([
    ['架空ワーク2個、許容0.02', 'ワークを固定する', false],
    ['架空ワーク2個', '架空ワーク2個を3回固定する', false],
    ['架空ワーク2個', '1. 架空ワーク2個を固定する', true],
    ['架空ワーク2個', '1.架空ワーク2個を固定する', true],
    ['架空ワーク２個、許容０.０２', '1. 架空ワーク2個\n2. 許容0.02', true],
    ['0.02以内', '0.03以内', false],
    ['架空ワーク2個', '', false],
    ['架空ワーク2個', '長'.repeat(100), false]
  ])('validates numbers and length (%s)', (original, rewritten, valid) => {
    expect(isValidProcedureTextRewrite(original, rewritten)).toBe(valid);
  });
  it('ignores unknown, missing, invalid and duplicate IDs while accepting good siblings', () => {
    const input = [text('a', 0.1, '架空ワーク2個'), text('b'), text('c')];
    const result = rewriteProcedureTexts(input, { texts: [{ id: 'a', text: '1. 架空ワーク2個を固定する' }, { id: 'unknown', text: '未知' }, { id: 'b', text: 5 }, { id: 'c', text: '変更1' }, { id: 'c', text: '変更2' }] });
    expect(result[0]).toMatchObject({ text: '1. 架空ワーク2個を固定する' }); expect(result.slice(1)).toEqual(input.slice(1));
    expect(rewriteProcedureTexts(input, { texts: [] })).toEqual(input);
  });
});
