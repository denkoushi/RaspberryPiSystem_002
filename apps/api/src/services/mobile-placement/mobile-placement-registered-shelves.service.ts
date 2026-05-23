/** 棚番登録UIのエリア・列ラベル（`formatShelfCodeRaw` と同一） */
const AREA_LABEL_TO_ID: Record<string, 'west' | 'central' | 'east'> = {
  西: 'west',
  中央: 'central',
  東: 'east'
};

const LINE_LABEL_TO_ID: Record<string, 'north' | 'central' | 'south'> = {
  北: 'north',
  中央: 'central',
  南: 'south'
};

export type RegisteredShelfEntry = {
  shelfCodeRaw: string;
  isStructured: boolean;
  areaId?: 'west' | 'central' | 'east';
  lineId?: 'north' | 'central' | 'south';
  /** 1..99（2桁表示はゼロ埋めと一致） */
  slot?: number;
  /** 段（4 セグメント形式 `西-北-02-1` のとき） */
  tier?: number;
  displayLabel?: string | null;
  macroZoneId?: string | null;
};

/**
 * `西-北-02` または `西-北-02-1`（段付き）形式を構造化として解釈。
 */
export function parseStructuredShelfCode(shelfCodeRaw: string): Omit<RegisteredShelfEntry, 'shelfCodeRaw'> {
  const raw = shelfCodeRaw.trim();
  const parts = raw.split('-');
  if (parts.length !== 3 && parts.length !== 4) {
    return { isStructured: false };
  }
  const [areaLabel, lineLabel, slotStr, tierStr] = parts;
  if (!areaLabel || !lineLabel || !slotStr) {
    return { isStructured: false };
  }
  const areaId = AREA_LABEL_TO_ID[areaLabel];
  const lineId = LINE_LABEL_TO_ID[lineLabel];
  if (!areaId || !lineId) {
    return { isStructured: false };
  }
  const slot = Number.parseInt(slotStr, 10);
  if (!Number.isFinite(slot) || slot < 1 || slot > 99) {
    return { isStructured: false };
  }
  let tier: number | undefined;
  if (parts.length === 4) {
    if (!tierStr) {
      return { isStructured: false };
    }
    const parsedTier = Number.parseInt(tierStr, 10);
    if (!Number.isFinite(parsedTier) || parsedTier < 0) {
      return { isStructured: false };
    }
    tier = parsedTier;
  }
  return {
    isStructured: true,
    areaId,
    lineId,
    slot,
    ...(tier !== undefined ? { tier } : {})
  };
}

// 一覧 API は `mobile-placement-shelf-master.service.ts` の `listRegisteredShelvesFromShelfMaster` を使用する。
