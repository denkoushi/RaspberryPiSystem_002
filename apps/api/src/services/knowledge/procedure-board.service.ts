import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';

import { layoutSchema, normalizeLayout, placeItem, type BoardItem, type BoardLayout } from './procedure-board-layout.js';
import type { PrismaProcedureBoardRepository } from './prisma-procedure-board.repository.js';

const identity = z.string().min(1).max(200);
const position = z.object({ page: z.number().int().min(1).max(3), row: z.number().int().nonnegative(),
  col: z.number().int().min(0).max(2), index: z.number().int().nonnegative() }).strict();
const work = { workId: z.string().uuid().optional(), activeMs: z.number().finite().min(0).max(86400000).optional() };
const material = { materialId: identity, ...work };
const located = { itemId: z.string().uuid(), materialId: identity.optional(), ...work };
const suggestion = { suggestionSetId: identity, proposalId: identity, materialId: identity };
const event = <T extends string, S extends z.ZodRawShape>(type: T, payload: S) => z.object({
  id: z.string().uuid(), type: z.literal(type), payload: z.object(payload).strict(),
}).strict();
export const boardEventSchema = z.discriminatedUnion('type', [
  event('placement_shown', suggestion),
  event('placement_accepted', { ...located, ...suggestion, to: position }),
  event('placement_dismissed', { ...suggestion, ...work }),
  event('ghost_relocated', { ...located, ...suggestion, to: position }),
  event('material_placed', { ...material, itemId: z.string().uuid(), to: position }),
  event('item_moved', { ...located, from: position, to: position }),
  event('item_removed', located), event('text_edited', located),
  event('text_created', { itemId: z.string().uuid() }),
  event('item_duplicated', { itemId: z.string().uuid(), sourceItemId: z.string().uuid() }),
  event('columns_resized', { page: z.number().int().min(1).max(3), row: z.number().int().nonnegative() }),
  event('heading_accepted', { suggestionSetId: identity, proposalId: identity }),
  event('heading_dismissed', { suggestionSetId: identity, proposalId: identity }),
  event('conflict_selected', { suggestionSetId: identity, proposalId: identity, selectedMaterialId: identity.nullable() }),
  event('format_requested', { suggestionSetId: identity }), event('format_accepted', { suggestionSetId: identity }),
  event('format_reverted', { suggestionSetId: identity }),
  event('material_work', { ...material, workId: z.string().uuid(), activeMs: z.number().finite().min(0).max(86400000), completed: z.boolean() }),
  event('addition_audited', { suggestionSetId: identity, unsupportedCount: z.number().int().min(0).max(10000) }),
]).superRefine((value, ctx) => {
  const payload = value.payload as { workId?: string; activeMs?: number };
  if (Boolean(payload.workId) !== (payload.activeMs !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'workId and activeMs must be supplied together' });
  }
});
export type BoardEvent = z.infer<typeof boardEventSchema>;
export const decisionsSchema = z.object({
  dismissedPlacements: z.array(z.object({ materialId: identity, materialFingerprint: identity }).strict()).max(600),
  dismissedHeadings: z.array(z.object({ page: z.number().int().min(1).max(3), text: z.string().max(120) }).strict()).max(600),
  conflicts: z.array(z.object({ materialIds: z.tuple([identity, identity]), selectedMaterialId: identity.nullable() }).strict()
    .refine(value => value.materialIds[0] !== value.materialIds[1] && (value.selectedMaterialId === null || value.materialIds.includes(value.selectedMaterialId)))).max(600),
}).strict();
export const emptyDecisions = () => decisionsSchema.parse({ dismissedPlacements: [], dismissedHeadings: [], conflicts: [] });
export const saveBoardSchema = z.object({ expectedVersion: z.number().int().positive(), layout: layoutSchema, event: boardEventSchema }).strict();
export const appendEventsSchema = z.object({ boardVersion: z.number().int().positive(), events: z.array(boardEventSchema).min(1).max(100) }).strict();
export const appendOnlyTypes = new Set(['placement_shown', 'material_work', 'addition_audited']);
export const boardItems = (layout: BoardLayout) => layout.pages.flatMap(page => page.rows.flatMap((row, r) => row.cols.flatMap((col, c) => col.items.map((item, index) => ({ item, at: { page: page.page, row: r, col: c, index } })))));
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
  return value;
}
export function invalidBoard(message = '盤面操作が一致しません'): never { throw new ApiError(400, message); }
export function boardConflict(currentVersion: number): never {
  throw new ApiError(409, '盤面が更新されています', { currentVersion }, 'PROCEDURE_BOARD_VERSION_CONFLICT');
}

export function validateLayoutEvent(before: BoardLayout, after: BoardLayout, event: BoardEvent): void {
  if (same(before, after)) invalidBoard();
  const oldItems = boardItems(before); const newItems = boardItems(after);
  const payload = event.payload;
  const id = 'itemId' in payload ? payload.itemId : undefined;
  const old = oldItems.find(entry => entry.item.itemId === id);
  const next = newItems.find(entry => entry.item.itemId === id);
  const othersBefore = oldItems.filter(entry => entry.item.itemId !== id).map(entry => entry.item);
  const othersAfter = newItems.filter(entry => entry.item.itemId !== id).map(entry => entry.item);
  const byId = (items: BoardItem[]) => [...items].sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (!same(byId(othersBefore), byId(othersAfter)) || before.pages.some((page, index) => page.heading !== after.pages[index].heading)) invalidBoard();
  if ('materialId' in payload && payload.materialId !== undefined) {
    const item = next?.item ?? old?.item;
    if (!item || item.kind !== 'material' || item.materialId !== payload.materialId) invalidBoard();
  }
  switch (event.type) {
    case 'material_placed':
      if (old || next?.item.kind !== 'material' || next.item.origin !== 'human' || next.item.materialId !== event.payload.materialId || !same(next.at, event.payload.to)) invalidBoard();
      break;
    case 'text_created':
      if (old || next?.item.kind !== 'text' || !next.item.text.trim() || next.item.style !== ({ title: 'heading', subtitle: 'subheading', body: 'body' } as const)[next.item.textKind]) invalidBoard();
      break;
    case 'item_duplicated': {
      const source = oldItems.find(entry => entry.item.itemId === event.payload.sourceItemId)?.item;
      if (old || !next || !source || !same({ ...source, itemId: id }, next.item)) invalidBoard();
      break;
    }
    case 'item_removed': if (!old || next) invalidBoard(); break;
    case 'item_moved':
      if (!old || !next || !same(old.item, next.item) || same(old.at, next.at) || !same(old.at, event.payload.from) || !same(next.at, event.payload.to)) invalidBoard();
      break;
    case 'text_edited': {
      if (!old || !next || !same(old.at, next.at)) invalidBoard();
      const key = old.item.kind === 'text' ? 'text' : 'override';
      const a = { ...old.item } as Record<string, unknown>; const b = { ...next.item } as Record<string, unknown>;
      delete a[key]; delete b[key];
      if (!same(a, b) || (next.item.kind === 'text' && !next.item.text.trim())) invalidBoard();
      break;
    }
    case 'columns_resized': {
      const strip = (layout: BoardLayout) => ({ ...layout, pages: layout.pages.map(page => ({ ...page, rows: page.rows.map(row => ({ ...row, w: [] })) })) });
      if (!same(strip(before), strip(after))) invalidBoard();
      const changed = before.pages.flatMap((page, p) => page.rows.flatMap((row, r) => same(row.w, after.pages[p].rows[r].w) ? [] : [{ page: page.page, row: r }]));
      if (!same(changed, [{ page: event.payload.page, row: event.payload.row }])) invalidBoard();
      break;
    }
    default: invalidBoard('この操作は提案APIから実行してください');
  }
  if (event.type === 'material_placed' || event.type === 'item_moved') {
    if (!next) invalidBoard();
    const to = event.payload.to;
    const targets = (['row', 'col', 'in'] as const).map(mode => ({ ...to, mode }));
    if (!targets.some(target => {
      try { return same(placeItem(before, next.item, target), after); } catch { return false; }
    })) invalidBoard();
  } else if (event.type !== 'columns_resized') {
    const remove = (layout: BoardLayout) => normalizeLayout({ ...layout, pages: layout.pages.map(page => ({ ...page,
      rows: page.rows.map(row => ({ ...row, cols: row.cols.map(col => ({ items: col.items.filter(item => item.itemId !== id) })) })) })) });
    if (!same(remove(before), remove(after))) invalidBoard();
  }
}

export class ProcedureBoardService {
  constructor(readonly repository: PrismaProcedureBoardRepository) {}
  async save(procedureId: string, clientDeviceId: string, raw: unknown) {
    const input = saveBoardSchema.parse(raw);
    return this.repository.save(procedureId, clientDeviceId, input.expectedVersion, normalizeLayout(input.layout), input.event);
  }
  async events(procedureId: string, clientDeviceId: string, raw: unknown) {
    const input = appendEventsSchema.parse(raw);
    if (input.events.some(event => !appendOnlyTypes.has(event.type))) invalidBoard('状態変更は保存APIへ送信してください');
    return this.repository.appendEvents(procedureId, clientDeviceId, input.boardVersion, input.events);
  }
}
