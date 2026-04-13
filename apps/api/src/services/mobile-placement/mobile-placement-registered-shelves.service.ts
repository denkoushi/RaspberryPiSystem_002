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
};

/**
 * `西-北-02` 形式のみ構造化として解釈。それ以外は `isStructured: false`。
 */
export function parseStructuredShelfCode(shelfCodeRaw: string): Omit<RegisteredShelfEntry, 'shelfCodeRaw'> {
  const raw = shelfCodeRaw.trim();
  const parts = raw.split('-');
  if (parts.length !== 3) {
    return { isStructured: false };
  }
  const [areaLabel, lineLabel, slotStr] = parts;
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
  return {
    isStructured: true,
    areaId,
    lineId,
    slot
  };
}

// 一覧 API は `mobile-placement-shelf-master.service.ts` の `listRegisteredShelvesFromShelfMaster` を使用する。
