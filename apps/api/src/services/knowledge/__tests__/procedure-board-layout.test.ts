import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { emptyLayout, layoutSchema, normalizeLayout, placeItem, type BoardItem } from '../procedure-board-layout.js';
import { validateLayoutEvent } from '../procedure-board.service.js';

const text = (): BoardItem => ({ itemId: randomUUID(), kind: 'text', textKind: 'body', text: '確認', origin: 'human', style: 'body' });
const material = (): Extract<BoardItem, { kind: 'material' }> => ({ itemId: randomUUID(), kind: 'material', materialId: 'mat-1', origin: 'human', style: 'figure' });
const target = { page: 1, row: 0, col: 0, index: 0, mode: 'row' as const };

describe('Procedure board layout', () => {
  it('removes empty columns with their widths, splits a single column and is idempotent', () => {
    const layout = emptyLayout(); const a = text(); const b = text();
    layout.pages[0].rows = [{ cols: [{ items: [] }, { items: [a, b] }], w: [3, 7] }, { cols: [], w: [] }];
    const normalized = normalizeLayout(layout);
    expect(normalized.pages[0].rows).toEqual([a, b].map(item => ({ cols: [{ items: [item] }], w: [1] })));
    expect(normalizeLayout(normalized)).toEqual(normalized);
  });
  it('keeps duplicate material references with distinct item identities', () => {
    const a = material(); const b = { ...a, itemId: randomUUID() };
    let layout = placeItem(emptyLayout(), a, target);
    layout = placeItem(layout, b, { ...target, row: 1 });
    layout = placeItem(layout, a, { ...target, row: 1 });
    expect(layout.pages[0].rows.map(row => row.cols[0].items[0].itemId)).toEqual([b.itemId, a.itemId]);
    const duplicate = structuredClone(layout); duplicate.pages[0].rows[1].cols[0].items[0].itemId = b.itemId;
    expect(layoutSchema.safeParse(duplicate).success).toBe(false);
  });
  it('starts text/photo at 2:1, allows three columns and rejects four', () => {
    let layout = placeItem(emptyLayout(), text(), target);
    layout = placeItem(layout, material(), { ...target, col: 1, mode: 'col' });
    expect(layout.pages[0].rows[0].w).toEqual([2 / 3, 1 / 3]);
    const before = layout; const item = material();
    layout = placeItem(layout, item, { ...target, col: 2, mode: 'col' });
    expect(() => validateLayoutEvent(before, layout, { id: randomUUID(), type: 'material_placed', payload: { itemId: item.itemId, materialId: item.materialId, to: { page: 1, row: 0, col: 2, index: 0 } } })).not.toThrow();
    expect(layout.pages[0].rows[0].w).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(() => placeItem(layout, text(), { ...target, col: 3, mode: 'col' })).toThrow();
    expect(normalizeLayout(layout)).toEqual(layout);
  });
  it('rejects bad page order, unknown keys, widths and item counts', () => {
    const layout = placeItem(placeItem(emptyLayout(), text(), target), text(), { ...target, col: 1, mode: 'col' });
    for (const w of [[0, 1], [-1, 2], [NaN, 1], [0.149, 0.851], [1], [1, 1, 1]]) {
      const invalid = structuredClone(layout); invalid.pages[0].rows[0].w = w;
      expect(layoutSchema.safeParse(invalid).success).toBe(false);
    }
    layout.pages[0].rows[0].w = [0.15, 0.85]; expect(layoutSchema.safeParse(layout).success).toBe(true);
    expect(layoutSchema.safeParse({ ...layout, extra: true }).success).toBe(false);
    const four = structuredClone(layout); four.pages[0].rows[0].cols.push({ items: [text()] }, { items: [text()] }); four.pages[0].rows[0].w = [1, 1, 1, 1];
    expect(layoutSchema.safeParse(four).success).toBe(false);
    const many = emptyLayout();
    for (const page of many.pages) page.rows = Array.from({ length: 200 }, () => ({ cols: [{ items: [text(), text()] }], w: [1] }));
    expect(layoutSchema.safeParse(many).success).toBe(false);
    layout.pages.reverse(); expect(layoutSchema.safeParse(layout).success).toBe(false);
  });
  it('checks the claimed operation against the whole layout', () => {
    const item = text(); const before = emptyLayout(); const after = placeItem(before, item, target);
    expect(() => validateLayoutEvent(before, after, { id: randomUUID(), type: 'text_created', payload: { itemId: item.itemId } })).not.toThrow();
    expect(() => validateLayoutEvent(before, after, { id: randomUUID(), type: 'item_moved', payload: { itemId: item.itemId, from: target, to: target } })).toThrow();
    const other = placeItem(after, text(), { ...target, row: 1 });
    expect(() => validateLayoutEvent(before, other, { id: randomUUID(), type: 'text_created', payload: { itemId: item.itemId } })).toThrow();
  });
});
