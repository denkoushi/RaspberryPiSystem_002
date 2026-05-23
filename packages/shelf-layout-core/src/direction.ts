export type CardinalDirection = '東' | '西' | '南' | '北' | '中央';

/**
 * 加工機セル (fr,fc) から対象セル (tr,tc) への相対方位。
 * プレビュー HTML `directionBetween` と同一。
 */
export function directionBetween(fr: number, fc: number, tr: number, tc: number): CardinalDirection {
  const dr = tr - fr;
  const dc = tc - fc;
  if (dr === 0 && dc === 0) {
    return '中央';
  }
  if (Math.abs(dr) > Math.abs(dc)) {
    return dr < 0 ? '北' : '南';
  }
  if (Math.abs(dc) > Math.abs(dr)) {
    return dc < 0 ? '西' : '東';
  }
  return dr < 0 ? '北' : '南';
}

export type MachineAnchor = {
  resourceName: string;
  r: number;
  c: number;
};

export type NearestMachineResult = {
  resourceName: string;
  direction: CardinalDirection;
} | null;

/**
 * セル群の重心から最近傍加工機を求め、相対方位を返す。
 */
export function nearestMachineDirection(
  cellIndices: number[],
  gridSize: number,
  machines: MachineAnchor[],
  indexToRc: (index: number, gridSize: number) => { r: number; c: number }
): NearestMachineResult {
  if (machines.length === 0 || cellIndices.length === 0) {
    return null;
  }
  const pts = cellIndices.map((i) => indexToRc(i, gridSize));
  const cr = pts.reduce((s, p) => s + p.r, 0) / pts.length;
  const cc = pts.reduce((s, p) => s + p.c, 0) / pts.length;

  let best = machines[0];
  let bestD = Infinity;
  for (const m of machines) {
    const d = Math.abs(m.r - cr) + Math.abs(m.c - cc);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return {
    resourceName: best.resourceName,
    direction: directionBetween(best.r, best.c, cr, cc)
  };
}
