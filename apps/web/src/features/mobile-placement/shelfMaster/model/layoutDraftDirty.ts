import type { DraftEntity, LayoutDraftSnapshot } from './shelfLayoutTypes';

function normalizeEntity(e: DraftEntity) {
  return {
    entityKind: e.entityKind,
    cellIndices: [...e.cellIndices].sort((a, b) => a - b),
    resourceCd: e.resourceCd ?? null,
    resourceName: e.resourceName ?? null,
    shelfCodeRaw: e.shelfCodeRaw ?? null,
    displayLabel: e.displayLabel ?? null,
    aisleLabel: e.aisleLabel ?? null
  };
}

export function normalizeLayoutDraft(snapshot: LayoutDraftSnapshot): string {
  const entities = [...snapshot.entities]
    .map(normalizeEntity)
    .sort((a, b) => {
      const ak = `${a.entityKind}:${a.cellIndices.join(',')}`;
      const bk = `${b.entityKind}:${b.cellIndices.join(',')}`;
      return ak.localeCompare(bk);
    });
  return JSON.stringify({ gridSize: snapshot.gridSize, entities });
}

export function isLayoutDraftDirty(
  baseline: LayoutDraftSnapshot | null,
  current: LayoutDraftSnapshot
): boolean {
  if (!baseline) {
    return false;
  }
  return normalizeLayoutDraft(baseline) !== normalizeLayoutDraft(current);
}

export function snapshotFromZone(gridSize: 3 | 4, entities: DraftEntity[]): LayoutDraftSnapshot {
  return {
    gridSize,
    entities: entities.map((e) => ({ ...e, cellIndices: [...e.cellIndices] }))
  };
}
