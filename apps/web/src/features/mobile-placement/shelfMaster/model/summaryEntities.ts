import type { DraftEntity } from './shelfLayoutTypes';
import type { ShelfLayoutEntityDto } from '../../../../api/client';

export function draftEntitiesFromSummary(entities: ShelfLayoutEntityDto[]): DraftEntity[] {
  return entities.map((e) => ({
    id: e.id,
    entityKind: e.entityKind,
    cellIndices: [...e.cellIndices],
    resourceCd: e.resourceCd,
    resourceName: e.resourceName,
    shelfCodeRaw: e.shelfCodeRaw,
    displayLabel: e.displayLabel,
    aisleLabel: e.aisleLabel
  }));
}
