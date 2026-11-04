import { z } from 'zod';

export const MAX_PAGES = 20;

export const styleSchema = z.enum(['heading', 'subheading', 'body', 'caution', 'key-number', 'figure']);
const itemSchema = z.discriminatedUnion('kind', [
  z.object({ itemId: z.string().uuid(), kind: z.literal('material'), materialId: z.string().min(1),
    override: z.string().max(12000).optional(), origin: z.enum(['human', 'ai-accepted']), style: styleSchema }).strict(),
  z.object({ itemId: z.string().uuid(), kind: z.literal('text'), textKind: z.enum(['title', 'subtitle', 'body']),
    text: z.string().max(12000), origin: z.literal('human'), style: styleSchema }).strict(),
]);
const rowSchema = z.object({ cols: z.array(z.object({ items: z.array(itemSchema).max(200) }).strict()).max(3),
  w: z.array(z.number().finite().positive()).max(3) }).strict()
  .refine(row => row.cols.length === row.w.length, 'Column widths must match columns');
export const layoutSchema = z.object({ formatVersion: z.literal(1), pages: z.array(z.object({
  page: z.number().int().min(1).max(MAX_PAGES), heading: z.string().max(120), rows: z.array(rowSchema).max(200),
}).strict()).min(1).max(MAX_PAGES) }).strict().superRefine((layout, ctx) => {
  const ids = layout.pages.flatMap(page => page.rows.flatMap(row => row.cols.flatMap(col => col.items.map(item => item.itemId))));
  if (layout.pages.some((page, index) => page.page !== index + 1) || ids.length > 600 || new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Invalid page order or item identities/count' });
  }
  for (const page of layout.pages) for (const row of page.rows) {
    if (row.w.length !== row.cols.length) continue;
    const widths = row.w.filter((_, index) => row.cols[index].items.length > 0);
    const sum = widths.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(sum) || widths.some(width => width / sum < 0.15 - 1e-9)) {
      ctx.addIssue({ code: 'custom', message: 'Each column must occupy at least 15%' });
    }
  }
});
export type BoardLayout = z.infer<typeof layoutSchema>;
export type BoardItem = z.infer<typeof itemSchema>;
export const targetSchema = z.object({ page: z.number().int().min(1).max(MAX_PAGES), row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(), index: z.number().int().nonnegative(), mode: z.enum(['row', 'col', 'in']) }).strict();
export type BoardTarget = z.infer<typeof targetSchema>;
export const emptyLayout = (): BoardLayout => ({ formatVersion: 1, pages: [1, 2, 3].map(page => ({ page, heading: '', rows: [] })) });

export function normalizeLayout(input: BoardLayout): BoardLayout {
  const layout = layoutSchema.parse(input);
  for (const page of layout.pages) page.rows = page.rows.flatMap(row => {
    const cols = row.cols.filter(col => col.items.length);
    const widths = row.w.filter((_, index) => row.cols[index].items.length);
    if (cols.length === 1) return cols[0].items.map(item => ({ cols: [{ items: [item] }], w: [1] }));
    const sum = widths.reduce((a, b) => a + b, 0);
    return cols.length ? [{ cols, w: widths.map(width => width / sum) }] : [];
  });
  return layoutSchema.parse(layout);
}

export function placeItem(input: BoardLayout, item: BoardItem, rawTarget: BoardTarget): BoardLayout {
  const target = targetSchema.parse(rawTarget);
  const layout = layoutSchema.parse(input);
  for (const page of layout.pages) for (const row of page.rows) for (const col of row.cols) {
    col.items = col.items.filter(existing => existing.itemId !== item.itemId);
  }
  const normalized = normalizeLayout(layout);
  const page = normalized.pages[target.page - 1];
  const invalid = () => { throw new Error('Invalid placement target'); };
  if (!page) return invalid();
  if (target.mode === 'row') {
    if (target.row > page.rows.length || target.col !== 0 || target.index !== 0) invalid();
    page.rows.splice(target.row, 0, { cols: [{ items: [item] }], w: [1] });
  } else {
    const row = page.rows[target.row];
    if (!row) return invalid();
    if (target.mode === 'col') {
      if (row.cols.length >= 3 || target.col > row.cols.length || target.index !== 0) invalid();
      const figure = item.style === 'figure';
      const otherFigure = row.cols[0].items.every(existing => existing.style === 'figure');
      row.cols.splice(target.col, 0, { items: [item] });
      row.w = row.cols.length === 2 && figure !== otherFigure
        ? row.cols.map(col => col.items.every(existing => existing.style === 'figure') ? 1 / 3 : 2 / 3)
        : row.cols.map(() => 1 / row.cols.length);
    } else {
      const col = row.cols[target.col];
      if (!col || target.index > col.items.length) return invalid();
      col.items.splice(target.index, 0, item);
    }
  }
  return normalizeLayout(normalized);
}

export type PageOperation =
  | { type: 'page_added'; payload: { page: number } }
  | { type: 'page_moved'; payload: { from: number; to: number } }
  | { type: 'page_removed'; payload: { page: number } };

/** Old page numbers in their new order; null denotes the inserted empty page. */
export function pageOrder(count: number, operation: PageOperation): (number | null)[] {
  const order: (number | null)[] = Array.from({ length: count }, (_, index) => index + 1);
  const valid = (page: number, max = count) => Number.isInteger(page) && page >= 1 && page <= max;
  if (operation.type === 'page_added') {
    if (count >= MAX_PAGES || !valid(operation.payload.page, count + 1)) throw new Error('Invalid page addition');
    order.splice(operation.payload.page - 1, 0, null);
  } else if (operation.type === 'page_removed') {
    if (count <= 1 || !valid(operation.payload.page)) throw new Error('Invalid page removal');
    order.splice(operation.payload.page - 1, 1);
  } else {
    const { from, to } = operation.payload;
    if (!valid(from) || !valid(to) || from === to) throw new Error('Invalid page move');
    order.splice(to - 1, 0, order.splice(from - 1, 1)[0]);
  }
  return order;
}

export function applyPageOperation(input: BoardLayout, operation: PageOperation): BoardLayout {
  const layout = layoutSchema.parse(input);
  return layoutSchema.parse({ ...layout, pages: pageOrder(layout.pages.length, operation).map((old, index) =>
    old === null ? { page: index + 1, heading: '', rows: [] } : { ...layout.pages[old - 1], page: index + 1 }) });
}
