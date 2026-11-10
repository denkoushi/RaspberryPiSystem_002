import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { weeklyMetrics, type RecordedBoardEvent } from '../procedure-board-metrics.js';

const start = new Date('2026-11-01T00:00:00+09:00');
const event = (type: RecordedBoardEvent['type'], payload: Record<string, unknown>, day = 0): RecordedBoardEvent => ({ id: randomUUID(), type, payload, clientDeviceId: 'client-1', occurredAt: new Date(start.getTime() + day * 86400000) });
const proposal = (id: number) => ({ suggestionSetId: 'set-1', proposalId: `p-${id}`, materialId: `m-${id}` });

describe('Procedure board weekly metrics', () => {
  it('deduplicates displays and attributes next-week adoption to the display week', () => {
    const shown = Array.from({ length: 10 }, (_, index) => event('placement_shown', proposal(index)));
    const events = [...shown, ...shown.map(entry => ({ ...entry, id: randomUUID() })),
      ...Array.from({ length: 6 }, (_, index) => event('placement_accepted', proposal(index), 8)),
      event('heading_accepted', { suggestionSetId: 'headings' }, 1), event('columns_resized', {}, 1), event('item_duplicated', {}, 1)];
    const result = weeklyMetrics(events, start, 2).weeks;
    expect(result[0]).toMatchObject({ displayedPlacements: 10, accepted: 6, acceptanceRate: 0.6 });
    expect(result[1]).toMatchObject({ displayedPlacements: 0, accepted: 0, acceptanceRate: null });
  });
  it('handles equal server timestamps and later audits when querying only an earlier week', () => {
    const accepted = { ...event('placement_accepted', proposal(1)), id: 'a' };
    const shown = { ...event('placement_shown', proposal(1)), id: 'b' };
    const audit = event('addition_audited', { suggestionSetId: 'set-1', unsupportedCount: 1 }, 8);
    expect(weeklyMetrics([accepted, shown, audit], start, 1).weeks[0]).toMatchObject({ accepted: 1, acceptanceRate: 1, unsupportedAdditions: 1, unauditedSuggestions: 0 });
  });
  it('counts completed cumulative work once per work and distinct material, and separates interruptions', () => {
    const events = Array.from({ length: 8 }, (_, index) => [
      event('material_work', { materialId: `m-${index}`, workId: `work-${index}`, activeMs: 10000, completed: false }, 1),
      event('material_work', { materialId: `m-${index}`, workId: `work-${index}`, activeMs: 30000, completed: true }, 1),
      event('material_work', { materialId: `m-${index}`, workId: `work-${index}`, activeMs: 30000, completed: true }, 1),
    ]).flat();
    events.push(event('material_work', { materialId: 'm-other', workId: 'interrupted', activeMs: 5000, completed: false }, 1));
    events.push(event('item_duplicated', { materialId: 'copy', workId: 'copy', activeMs: 5000 }, 1));
    expect(weeklyMetrics(events, start, 1).weeks[0]).toMatchObject({ handledMaterials: 8, activeMs: 240000, msPerMaterial: 30000, incompleteWork: 1 });
  });
  it('excludes demos, splits weeks and reports latest audits and unaudited sets', () => {
    const events = [event('material_placed', {}, -1), event('placement_shown', proposal(1), 0),
      event('placement_shown', { ...proposal(2), suggestionSetId: 'set-2' }, 7),
      event('addition_audited', { suggestionSetId: 'set-1', unsupportedCount: 2 }, 1),
      event('addition_audited', { suggestionSetId: 'set-1', unsupportedCount: 0 }, 8),
      event('material_work', { materialId: 'm1', workId: 'split', activeMs: 100, completed: true }, 6),
      event('material_work', { materialId: 'm1', workId: 'split', activeMs: 200, completed: true }, 7)];
    const rows = weeklyMetrics(events, start, 2).weeks;
    expect(rows[0]).toMatchObject({ manual: 0, activeMs: 100, unsupportedAdditions: 0, unauditedSuggestions: 0 });
    expect(rows[1]).toMatchObject({ activeMs: 200, unauditedSuggestions: 1 });
  });
  it('counts only actual modification types and never calls a displayed placement manual', () => {
    const events = [event('placement_shown', proposal(1)), event('material_placed', { materialId: 'm-1' }, 1),
      event('material_placed', { materialId: 'm-other' }, 1), ...(['placement_dismissed', 'ghost_relocated', 'item_moved', 'text_edited', 'item_removed'] as const).map(type => event(type, {}, 1))];
    expect(weeklyMetrics(events, start, 1).weeks[0]).toMatchObject({ manual: 1, modified: 5 });
  });
});
