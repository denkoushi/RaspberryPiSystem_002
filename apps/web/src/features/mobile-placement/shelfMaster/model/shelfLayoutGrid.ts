import { indexToRc } from '@raspi-system/shelf-layout-core';

import type { DraftEntity } from './shelfLayoutTypes';

export function entityAtCell(entities: DraftEntity[], cellIndex: number): DraftEntity | null {
  return entities.find((e) => e.cellIndices.includes(cellIndex)) ?? null;
}

export type ShelfLayoutRenderItem = {
  entity: DraftEntity | null;
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
  cells: number[];
};

export function buildRenderItems(entities: DraftEntity[], gridSize: number): ShelfLayoutRenderItem[] {
  const covered = new Set<number>();
  const items: ShelfLayoutRenderItem[] = [];
  for (const e of entities) {
    const rs = e.cellIndices.map((i) => indexToRc(i, gridSize).r);
    const cs = e.cellIndices.map((i) => indexToRc(i, gridSize).c);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    const minC = Math.min(...cs);
    const maxC = Math.max(...cs);
    e.cellIndices.forEach((i) => covered.add(i));
    items.push({ entity: e, minR, maxR, minC, maxC, cells: e.cellIndices });
  }
  const max = gridSize * gridSize;
  for (let i = 0; i < max; i += 1) {
    if (!covered.has(i)) {
      const { r, c } = indexToRc(i, gridSize);
      items.push({ entity: null, minR: r, maxR: r, minC: c, maxC: c, cells: [i] });
    }
  }
  return items;
}
