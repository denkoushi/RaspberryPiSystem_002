import { createHash, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { PrismaProcedureBoardRepository } from '../prisma-procedure-board.repository.js';
import { validatePlacementResult } from '../procedure-board-inference.js';
import { emptyLayout, placeItem, type BoardLayout } from '../procedure-board-layout.js';
import { cumulativeStats } from '../procedure-board-metrics.js';
import { boardEventSchema, emptyDecisions, validateLayoutEvent } from '../procedure-board.service.js';

function fixture(layout = emptyLayout()) {
  let board = { id: 'board', procedureId: 'procedure', version: 1, layout, decisions: emptyDecisions(),
    materialFingerprint: createHash('sha256').update('[]').digest('hex'), lastRequestedClientDeviceId: 'client', trialStartedAt: null };
  const events: { id: string; type: string; payload: unknown; boardVersion: number }[] = [];
  const job = { id: 'suggestions', state: 'ready', boardVersion: 1, result: {
    placements: [], headings: [{ id: 'h', page: 1, text: '準備' }], gaps: [], conflicts: [],
  } };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    knowledgeProcedureBoard: {
      findUnique: vi.fn(async () => board),
      update: vi.fn(async ({ data }: { data: Partial<Omit<typeof board, 'version'>> & { version?: { increment: number } } }) => {
        const { version, ...rest } = data;
        board = { ...board, ...rest, version: board.version + (version?.increment ?? 0) }; return board;
      }),
    },
    knowledgeProcedureMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeProcedureBoardEvent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => events.find(event => event.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: typeof events[number] }) => { events.push(data); return data; }),
    },
    knowledgeProcedureBoardAi: {
      updateMany: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(async () => job), findUnique: vi.fn(async () => job),
    },
  };
  const db = { ...tx, $transaction: async <T>(run: (value: typeof tx) => Promise<T>) => run(tx) };
  return { repository: new PrismaProcedureBoardRepository(db as unknown as PrismaClient), tx, events, job, current: () => board };
}
const first = { page: 1, row: 0, col: 0, index: 0, mode: 'row' as const };

describe('Procedure board heading cards', () => {
  it.each(['accept', 'relocate'] as const)('creates a human-origin title card on %s and suppresses the original proposal after editing/removal', async action => {
    const existing = { itemId: randomUUID(), kind: 'text' as const, textKind: 'body' as const, text: '本文', style: 'body' as const, origin: 'human' as const };
    const initial = placeItem(emptyLayout(), existing, first);
    const f = fixture(initial); const itemId = randomUUID(); const eventId = randomUUID();
    const target = { ...first, page: 2 };
    const input = { expectedVersion: 1, eventId, proposalId: 'h', action, itemId, ...(action === 'relocate' ? { target } : {}) };
    const saved = await f.repository.decidePlacement('procedure', 'client', 'suggestions', input);
    const page = action === 'accept' ? 1 : 2;
    const title = { itemId, kind: 'text', textKind: 'title', style: 'heading', text: '準備', origin: 'human' };
    expect(saved.layout.pages[page - 1].rows[0].cols[0].items[0]).toEqual(title);
    expect(saved.layout.pages[0].heading).toBe(''); expect(saved.version).toBe(2);
    const event = f.events[0];
    expect(boardEventSchema.parse(event && { id: event.id, type: event.type, payload: event.payload })).toEqual({
      id: eventId, type: action === 'accept' ? 'heading_accepted' : 'ghost_relocated',
      payload: { suggestionSetId: 'suggestions', proposalId: 'h', itemId, to: { page, row: 0, col: 0, index: 0 } },
    });
    if (action === 'relocate') expect(cumulativeStats([{ ...event, type: 'ghost_relocated', payload: event.payload as Record<string, unknown>, occurredAt: new Date(), clientDeviceId: 'client' }], null).modified).toBe(1);
    expect(saved.decisions).toEqual({ ...emptyDecisions(), dismissedHeadings: [{ page: 1, text: '準備' }] });
    // Suppression belongs to the original page and survives editing, moving or deleting the card.
    expect(validatePlacementResult(f.job.result, { layout: initial, decisions: saved.decisions, materialFingerprint: '', materials: [] }).headings).toEqual([]);
    expect((await f.repository.decidePlacement('procedure', 'client', 'suggestions', input)).version).toBe(2);
    expect(f.events).toHaveLength(1);
  });
  it('rejects missing/duplicate item identities and relocation to the proposed position', async () => {
    for (const patch of [{}, { itemId: randomUUID(), action: 'relocate' as const, target: first }]) {
      const f = fixture();
      await expect(f.repository.decidePlacement('procedure', 'client', 'suggestions', {
        expectedVersion: 1, eventId: randomUUID(), proposalId: 'h', action: 'accept', ...patch,
      })).rejects.toMatchObject({ statusCode: 400 });
      expect(f.events).toHaveLength(0);
    }
    const itemId = randomUUID();
    const f = fixture(placeItem(emptyLayout(), { itemId, kind: 'text', textKind: 'body', style: 'body', text: '本文', origin: 'human' }, first));
    await expect(f.repository.decidePlacement('procedure', 'client', 'suggestions', {
      expectedVersion: 1, eventId: randomUUID(), proposalId: 'h', action: 'accept', itemId,
    })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('migrates old headings under the board lock exactly once with a new version and event', async () => {
    const legacy = emptyLayout(); legacy.pages[0].heading = '準備'; legacy.pages[2].heading = '仕上げ';
    const f = fixture(legacy);
    const saved = await f.repository.get('procedure', 'client');
    expect(f.tx.$queryRaw.mock.calls.length).toBeGreaterThan(0);
    expect(saved.version).toBe(2); expect(saved.layout.pages.map(page => page.heading)).toEqual(['', '', '']);
    const items = [saved.layout.pages[0], saved.layout.pages[2]].map(page => page.rows[0].cols[0].items[0]);
    expect(items.map(item => item.kind === 'text' && item.text)).toEqual(['準備', '仕上げ']);
    expect(items.every(item => item.kind === 'text' && item.origin === 'human' && item.style === 'heading')).toBe(true);
    expect(f.events).toEqual([expect.objectContaining({ type: 'headings_migrated', boardVersion: 2, payload: { itemIds: items.map(item => item.itemId) } })]);
    expect(saved.decisions).toEqual({ ...emptyDecisions(), dismissedHeadings: [{ page: 1, text: '準備' }, { page: 3, text: '仕上げ' }] });
    const again = await f.repository.get('procedure', 'client');
    expect(again.layout).toEqual(saved.layout); expect(again.version).toBe(2); expect(f.events).toHaveLength(1);
    expect(validatePlacementResult(f.job.result, { layout: saved.layout, decisions: saved.decisions, materialFingerprint: '', materials: [] }).headings).toEqual([]);
    const edited = structuredClone(saved.layout); const title = edited.pages[0].rows[0].cols[0].items[0];
    if (title.kind === 'text') title.text = '修正見出し';
    expect(() => validateLayoutEvent(saved.layout, edited, { id: randomUUID(), type: 'text_edited', payload: { itemId: title.itemId } })).not.toThrow();
    const moved = placeItem(saved.layout, items[0], { ...first, page: 2 });
    expect(() => validateLayoutEvent(saved.layout, moved, { id: randomUUID(), type: 'item_moved', payload: { itemId: items[0].itemId, from: { page: 1, row: 0, col: 0, index: 0 }, to: { page: 2, row: 0, col: 0, index: 0 } } })).not.toThrow();
    const removed: BoardLayout = structuredClone(saved.layout); removed.pages[0].rows = [];
    expect(() => validateLayoutEvent(saved.layout, removed, { id: randomUUID(), type: 'item_removed', payload: { itemId: title.itemId } })).not.toThrow();
    edited.pages[0].heading = '不正な見出し変更';
    expect(() => validateLayoutEvent(saved.layout, edited, { id: randomUUID(), type: 'text_edited', payload: { itemId: title.itemId } })).toThrow();
  });
});
