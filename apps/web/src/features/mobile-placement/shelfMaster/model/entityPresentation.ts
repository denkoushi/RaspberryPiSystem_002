import type { DraftEntity } from './shelfLayoutTypes';

export type EntityCellPresentation = {
  mainLabel: string;
  shelfCodeRaw: string | null;
  kindBadge: string | null;
  kindClass: 'machine' | 'shelf' | 'aisle' | 'unused';
};

export function entityMainLabel(entity: DraftEntity | null): string {
  if (!entity) return '—';
  if (entity.entityKind === 'MACHINE') return entity.resourceName ?? '加工機';
  if (entity.entityKind === 'SHELF') return entity.displayLabel ?? entity.shelfCodeRaw ?? '棚';
  if (entity.entityKind === 'AISLE') return entity.aisleLabel ?? '通路';
  return '—';
}

export function entityKindBadge(entity: DraftEntity | null): string | null {
  if (!entity) return null;
  if (entity.entityKind === 'MACHINE') return '機';
  if (entity.entityKind === 'SHELF') return '棚';
  if (entity.entityKind === 'AISLE') return '路';
  return null;
}

export function entityCellPresentation(entity: DraftEntity | null): EntityCellPresentation {
  const kind = entity?.entityKind?.toLowerCase() ?? 'unused';
  const kindClass =
    kind === 'machine' ? 'machine' : kind === 'shelf' ? 'shelf' : kind === 'aisle' ? 'aisle' : 'unused';
  return {
    mainLabel: entityMainLabel(entity),
    shelfCodeRaw: entity?.shelfCodeRaw ?? null,
    kindBadge: entityKindBadge(entity),
    kindClass
  };
}
