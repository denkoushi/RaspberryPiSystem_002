import { describe, expect, it } from 'vitest';

import * as server from '../../../../api/src/services/knowledge/procedure-board-layout';

import * as web from './procedureBoardLayout';

import type { BoardItem } from './procedureBoardLayout';

const text = (): BoardItem => ({ itemId: crypto.randomUUID(), kind: 'text', textKind: 'body', text: '<b>原文</b>', origin: 'human', style: 'body' });
const figure = (): BoardItem => ({ itemId: crypto.randomUUID(), kind: 'material', materialId: 'm1', origin: 'human', style: 'figure' });
const target = { page: 1, row: 0, col: 0, index: 0, mode: 'row' as const };
describe('web / API layout contract', () => {
  it('matches placement, duplicate references, 2:1, three columns, moves and single-column restoration', () => {
    let client = web.emptyLayout(); let api = server.emptyLayout();
    const a = text(), b = figure(), c = figure();
    for (const [item, to] of [[a, target], [b, { ...target, col: 1, mode: 'col' }], [c, { ...target, col: 2, mode: 'col' }],
      [b, { ...target, row: 1 }], [c, { ...target, page: 3 }]] as const) {
      client = web.placeItem(client, item, to); api = server.placeItem(api, item, to);
      expect(client).toEqual(api); expect(web.normalizeLayout(client)).toEqual(client);
      if (web.boardItems(client).length === 2) expect(client.pages[0].rows[0].w).toEqual([2 / 3, 1 / 3]);
    }
    expect(web.boardItems(client).filter(entry => entry.item.kind === 'material')).toHaveLength(2);
    expect(client.pages[0].rows[0].w).toEqual([1]);
  });
  it('accepts only human-origin text cards while preserving AI material origins', () => {
    const title: BoardItem = { itemId: crypto.randomUUID(), kind: 'text', textKind: 'title', text: '準備', origin: 'human', style: 'heading' };
    for (const schema of [web.layoutSchema, server.layoutSchema]) {
      const layout = web.placeItem(web.emptyLayout(), title, target);
      expect(schema.parse(layout)).toEqual(layout);
      const aiText = structuredClone(layout);
      Object.assign(aiText.pages[0].rows[0].cols[0].items[0], { origin: 'ai-accepted' });
      expect(schema.safeParse(aiText).success).toBe(false);
      const aiMaterial = web.placeItem(layout, { itemId: crypto.randomUUID(), kind: 'material', materialId: 'm1', origin: 'ai-accepted', style: 'figure' }, { ...target, row: 1 });
      expect(schema.parse(aiMaterial)).toEqual(aiMaterial);
    }
  });
  it('matches normalization of empty columns and stacked items', () => {
    const input = web.emptyLayout(); input.pages[0].rows = [{ cols: [{ items: [] }, { items: [text(), text()] }], w: [3, 7] }, { cols: [], w: [] }];
    expect(web.normalizeLayout(input)).toEqual(server.normalizeLayout(input));
    expect(web.normalizeLayout(web.normalizeLayout(input))).toEqual(web.normalizeLayout(input));
  });
  it('rejects the same malformed widths, identities, pages, keys and fourth columns', () => {
    const base = web.placeItem(web.placeItem(web.emptyLayout(), text(), target), figure(), { ...target, col: 1, mode: 'col' });
    for (const widths of [[0, 1], [-1, 2], [NaN, 1], [Infinity, 1], [.149, .851], [1], [1, 1, 1], [.15, .85]]) {
      const input = structuredClone(base); input.pages[0].rows[0].w = widths;
      expect(web.layoutSchema.safeParse(input).success).toBe(server.layoutSchema.safeParse(input).success);
      expect(web.layoutSchema.safeParse(input).success).toBe(widths[0] === .15);
    }
    const malformed = [ { ...base, extra: true }, { ...base, pages: [...base.pages].reverse() } ];
    const duplicate = structuredClone(base); duplicate.pages[0].rows[0].cols[1].items[0].itemId = duplicate.pages[0].rows[0].cols[0].items[0].itemId;
    const four = structuredClone(base); four.pages[0].rows[0].cols.push({ items: [text()] }, { items: [text()] }); four.pages[0].rows[0].w = [1, 1, 1, 1];
    for (const input of [...malformed, duplicate, four]) {
      expect(web.layoutSchema.safeParse(input).success).toBe(false); expect(server.layoutSchema.safeParse(input).success).toBe(false);
    }
    const three = web.placeItem(base, text(), { ...target, col: 2, mode: 'col' });
    expect(() => web.placeItem(three, text(), { ...target, col: 3, mode: 'col' })).toThrow();
    expect(() => server.placeItem(three, text(), { ...target, col: 3, mode: 'col' })).toThrow();
  });
});

describe('variable page contract', () => {
  it.each([0, 1, 3, 20, 21])('accepts 1..20 sequential pages (%s)', count => {
    const layout = { formatVersion: 1, pages: Array.from({ length: count }, (_, index) => ({ page: index + 1, heading: '', rows: [] })) };
    for (const schema of [web.layoutSchema, server.layoutSchema]) expect(schema.safeParse(layout).success).toBe(count >= 1 && count <= 20);
    if (count > 0) {
      layout.pages[count - 1].page += 1;
      for (const schema of [web.layoutSchema, server.layoutSchema]) expect(schema.safeParse(layout).success).toBe(false);
    }
  });
  it('matches add/move/remove, retains page contents and rejects boundaries', () => {
    let client = web.placeItem(web.emptyLayout(), text(), { ...target, page: 2 }); let api = client;
    const original = client.pages[1].rows;
    const operations: web.PageOperation[] = [
      { type: 'page_added', payload: { page: 2 } }, { type: 'page_moved', payload: { from: 3, to: 1 } },
      { type: 'page_removed', payload: { page: 2 } },
    ];
    for (const operation of operations) {
      client = web.applyPageOperation(client, operation); api = server.applyPageOperation(api, operation);
      expect(client).toEqual(api); expect(client.pages.map(page => page.page)).toEqual(client.pages.map((_, index) => index + 1));
    }
    expect(client.pages[0].rows).toEqual(original);
    expect(web.applyPageOperation(client, { type: 'page_removed', payload: { page: 1 } }).pages.every(page => !page.rows.length)).toBe(true);
    for (const implementation of [web, server]) {
      const single = { ...client, pages: [client.pages[0]] };
      expect(() => implementation.applyPageOperation(single, { type: 'page_removed', payload: { page: 1 } })).toThrow();
      expect(() => implementation.applyPageOperation(client, { type: 'page_moved', payload: { from: 1, to: 4 } })).toThrow();
      expect(() => implementation.applyPageOperation(client, { type: 'page_moved', payload: { from: 1, to: 1 } })).toThrow();
      let full = client;
      while (full.pages.length < 20) full = implementation.applyPageOperation(full, { type: 'page_added', payload: { page: 1 } });
      expect(() => implementation.applyPageOperation(full, { type: 'page_added', payload: { page: 1 } })).toThrow();
      expect(() => implementation.placeItem(single, text(), { ...target, page: 2 })).toThrow('Invalid placement target');
    }
  });
});
