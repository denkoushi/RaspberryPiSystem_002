import type { BoardEvent } from './procedure-board.service.js';

export type RecordedBoardEvent = { id: string; type: BoardEvent['type']; occurredAt: Date; clientDeviceId: string;
  payload: Record<string, unknown> };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const modifiedTypes = new Set(['placement_dismissed', 'ghost_relocated', 'item_moved', 'item_removed', 'text_edited']);
const keyOf = (event: RecordedBoardEvent) => `${event.payload.suggestionSetId}:${event.payload.proposalId}`;

export function weeklyMetrics(events: RecordedBoardEvent[], trialStart: Date, weeks: number) {
  const start = trialStart.getTime();
  const rows = Array.from({ length: weeks }, (_, index) => ({ week: index + 1, displayedPlacements: 0, accepted: 0,
    acceptanceRate: null as number | null, modified: 0, manual: 0, handledMaterials: 0, activeMs: 0,
    msPerMaterial: null as number | null, incompleteWork: 0, unsupportedAdditions: 0, unauditedSuggestions: 0 }));
  const eligible = [...events].filter(event => event.occurredAt.getTime() >= start).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const shown = new Map<string, { week: number }>();
  const accepted = new Set<string>();
  const audits = new Map<string, RecordedBoardEvent>();
  const suggestionWeeks = new Map<string, number>();
  const work = new Map<string, { week: number; materialId: string; activeMs: number; complete: boolean }>();
  const seenIds = new Set<string>();
  for (const event of eligible) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    const week = Math.floor((event.occurredAt.getTime() - start) / WEEK);
    const row = rows[week];
    const setId = event.payload.suggestionSetId;
    if (typeof setId === 'string' && event.type !== 'addition_audited' && !suggestionWeeks.has(setId) && row) suggestionWeeks.set(setId, week);
    if (event.type === 'addition_audited' && typeof setId === 'string') audits.set(setId, event);
    if (event.type === 'placement_shown' && !shown.has(keyOf(event)) && row) {
      shown.set(keyOf(event), { week }); row.displayedPlacements++;
    }
    if (event.type === 'placement_accepted') accepted.add(keyOf(event));
    if (!row) continue;
    if (modifiedTypes.has(event.type)) row.modified++;
    if (event.type === 'material_placed' && !eligible.some(other => other.type === 'placement_shown'
      && other.payload.materialId === event.payload.materialId && other.occurredAt <= event.occurredAt)) row.manual++;
    const { workId, materialId, activeMs } = event.payload;
    if (typeof workId === 'string' && typeof materialId === 'string' && typeof activeMs === 'number'
      && !['item_duplicated', 'text_created'].includes(event.type)) {
      const key = `${event.clientDeviceId}:${workId}:${week}`;
      const previous = work.get(key);
      work.set(key, { week, materialId, activeMs: Math.max(previous?.activeMs ?? 0, activeMs),
        complete: (previous?.complete ?? false) || (event.type === 'material_work' ? event.payload.completed === true : true) });
    }
  }
  for (const [key, display] of shown) if (accepted.has(key)) rows[display.week].accepted++;
  const materials = rows.map(() => new Set<string>());
  for (const entry of work.values()) {
    if (entry.complete) { rows[entry.week].activeMs += entry.activeMs; materials[entry.week].add(entry.materialId); }
    else rows[entry.week].incompleteWork++;
  }
  for (const [setId, week] of suggestionWeeks) {
    const audit = audits.get(setId);
    if (audit) rows[week].unsupportedAdditions += Number(audit.payload.unsupportedCount);
    else rows[week].unauditedSuggestions++;
  }
  for (const [index, row] of rows.entries()) {
    row.handledMaterials = materials[index].size;
    row.acceptanceRate = row.displayedPlacements ? row.accepted / row.displayedPlacements : null;
    row.msPerMaterial = row.handledMaterials ? row.activeMs / row.handledMaterials : null;
  }
  return { timezone: 'Asia/Tokyo', weeks: rows };
}

export function cumulativeStats(events: RecordedBoardEvent[], trialStart: Date | null) {
  const start = trialStart ?? new Date(0);
  const weeks = Math.max(1, Math.floor((Date.now() - start.getTime()) / WEEK) + 1);
  const totals = weeklyMetrics(events, start, weeks).weeks;
  return totals.reduce((result, row) => ({ accepted: result.accepted + row.accepted,
    modified: result.modified + row.modified, manual: result.manual + row.manual }), { accepted: 0, modified: 0, manual: 0 });
}
