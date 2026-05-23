/** 9 マクロ区画 ID（サイネージ `PartsShelfZoneId` と同一） */
export type MacroZoneId = 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se';

export type ShelfAreaId = 'west' | 'central' | 'east';
export type ShelfLineId = 'north' | 'central' | 'south';

export type MacroZoneDefinition = {
  id: MacroZoneId;
  /** 工場マップ上の行（0=西エリア列） */
  factoryRow: number;
  /** 工場マップ上の列（0=北エリア列） */
  factoryCol: number;
  /** 表示名（例: 西·北） */
  displayName: string;
  /** 棚番 prefix（例: 西-北） */
  shelfPrefix: string;
  areaId: ShelfAreaId;
  lineId: ShelfLineId;
};

/**
 * 工場 3×3: 行=エリア（西/中央/東）、列=列方向（北/中央/南）。
 * `shelf-zone-map.ts` の areaId/lineId → MacroZoneId と一致させる。
 */
export const MACRO_ZONE_CATALOG: readonly MacroZoneDefinition[] = [
  { id: 'nw', factoryRow: 0, factoryCol: 0, displayName: '西·北', shelfPrefix: '西-北', areaId: 'west', lineId: 'north' },
  { id: 'w', factoryRow: 0, factoryCol: 1, displayName: '西·中央', shelfPrefix: '西-中央', areaId: 'west', lineId: 'central' },
  { id: 'sw', factoryRow: 0, factoryCol: 2, displayName: '西·南', shelfPrefix: '西-南', areaId: 'west', lineId: 'south' },
  { id: 'n', factoryRow: 1, factoryCol: 0, displayName: '中央·北', shelfPrefix: '中央-北', areaId: 'central', lineId: 'north' },
  { id: 'c', factoryRow: 1, factoryCol: 1, displayName: '中央·中央', shelfPrefix: '中央-中央', areaId: 'central', lineId: 'central' },
  { id: 's', factoryRow: 1, factoryCol: 2, displayName: '中央·南', shelfPrefix: '中央-南', areaId: 'central', lineId: 'south' },
  { id: 'ne', factoryRow: 2, factoryCol: 0, displayName: '東·北', shelfPrefix: '東-北', areaId: 'east', lineId: 'north' },
  { id: 'e', factoryRow: 2, factoryCol: 1, displayName: '東·中央', shelfPrefix: '東-中央', areaId: 'east', lineId: 'central' },
  { id: 'se', factoryRow: 2, factoryCol: 2, displayName: '東·南', shelfPrefix: '東-南', areaId: 'east', lineId: 'south' }
] as const;

const MACRO_ZONE_BY_ID = new Map(MACRO_ZONE_CATALOG.map((z) => [z.id, z]));

export function getMacroZoneById(id: MacroZoneId): MacroZoneDefinition {
  const zone = MACRO_ZONE_BY_ID.get(id);
  if (!zone) {
    throw new Error(`Unknown macro zone: ${id}`);
  }
  return zone;
}

export function macroZoneIdFromStructured(areaId: ShelfAreaId, lineId: ShelfLineId): MacroZoneId | null {
  const found = MACRO_ZONE_CATALOG.find((z) => z.areaId === areaId && z.lineId === lineId);
  return found?.id ?? null;
}

export function shelfPrefixForMacroZone(macroZoneId: MacroZoneId): string {
  return getMacroZoneById(macroZoneId).shelfPrefix;
}

/** サイネージ zone ラベル（北·西 等） */
export const PARTS_SHELF_ZONE_DIR_LABEL: Record<MacroZoneId, string> = {
  nw: '北·西',
  n: '北·中央',
  ne: '北·東',
  w: '中央·西',
  c: '中央·中央',
  e: '中央·東',
  sw: '南·西',
  s: '南·中央',
  se: '南·東'
};

export function indexToRc(index: number, gridSize: number): { r: number; c: number } {
  return { r: Math.floor(index / gridSize), c: index % gridSize };
}

export function rcToIndex(r: number, c: number, gridSize: number): number {
  return r * gridSize + c;
}

export function getNeighborMacroZoneId(
  centerId: MacroZoneId,
  direction: 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'
): MacroZoneId | null {
  const center = getMacroZoneById(centerId);
  const delta: Record<string, [number, number]> = {
    nw: [-1, -1],
    n: [-1, 0],
    ne: [-1, 1],
    w: [0, -1],
    e: [0, 1],
    sw: [1, -1],
    s: [1, 0],
    se: [1, 1]
  };
  const [dr, dc] = delta[direction] ?? [0, 0];
  const nr = center.factoryRow + dr;
  const nc = center.factoryCol + dc;
  const found = MACRO_ZONE_CATALOG.find((z) => z.factoryRow === nr && z.factoryCol === nc);
  return found?.id ?? null;
}
