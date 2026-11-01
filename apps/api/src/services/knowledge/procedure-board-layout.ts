import { z } from 'zod';

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
  page: z.number().int().min(1).max(3), heading: z.string().max(120), rows: z.array(rowSchema).max(200),
}).strict()).length(3) }).strict().superRefine((layout, ctx) => {
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
export const targetSchema = z.object({ page: z.number().int().min(1).max(3), row: z.number().int().nonnegative(),
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
