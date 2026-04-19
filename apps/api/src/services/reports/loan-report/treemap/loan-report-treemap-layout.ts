/**
 * Squarified treemap layout (Bruls et al.) — pure geometry, no DOM/SVG.
 * Used by loan report supply hero (server-rendered SVG).
 */

export interface TreemapInputCell {
  v: number;
}

export interface TreemapLaidOutCell<T> extends TreemapInputCell {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
}

function worst(row: Array<{ a: number }>, s: number): number {
  if (row.length === 0) return Infinity;
  let sum = 0;
  let maxA = -Infinity;
  let minA = Infinity;
  for (const n of row) {
    sum += n.a;
    maxA = Math.max(maxA, n.a);
    minA = Math.min(minA, n.a);
  }
  const s2 = s * s;
  return Math.max((s2 * maxA) / (sum * sum), (sum * sum) / (s2 * minA));
}

type Prepared<T> = TreemapInputCell & { a: number; data: T };

function layRecursive<T>(items: Prepared<T>[], rx: number, ry: number, rw: number, rh: number, out: TreemapLaidOutCell<T>[]): void {
  if (!items.length) return;
  if (items.length === 1) {
    const n = items[0];
    out.push({ v: n.v, x: rx, y: ry, w: Math.max(0, rw), h: Math.max(0, rh), data: n.data });
    return;
  }
  const horiz = rw >= rh;
  const shortSide = Math.max(0.0001, horiz ? rh : rw);
  let row: Prepared<T>[] = [];
  const rest = items.slice();
  while (rest.length) {
    const next = rest[0];
    const trial = row.concat([next]);
    if (row.length > 0 && worst(trial, shortSide) >= worst(row, shortSide)) break;
    row = trial;
    rest.shift();
  }
  if (!row.length) {
    row = [rest.shift()!];
  }
  const sumRow = row.reduce((s, n) => s + n.a, 0);
  if (horiz) {
    const rowH = sumRow / rw;
    let cx = rx;
    for (const n of row) {
      const cw = n.a / rowH;
      layRecursive([n], cx, ry, cw, rowH, out);
      cx += cw;
    }
    layRecursive(rest, rx, ry + rowH, rw, Math.max(0, rh - rowH), out);
  } else {
    const rowW = sumRow / rh;
    let cy = ry;
    for (const n of row) {
      const ch = n.a / rowW;
      layRecursive([n], rx, cy, rowW, ch, out);
      cy += ch;
    }
    layRecursive(rest, rx + rowW, ry, Math.max(0, rw - rowW), rh, out);
  }
}

/**
 * Squarify nodes with positive weights `.v` into rectangle (x,y,w,h). Area ∝ v.
 */
export function squarifyLayout<T>(
  nodes: Array<{ v: number; data: T }>,
  x: number,
  y: number,
  w: number,
  h: number
): TreemapLaidOutCell<T>[] {
  const sumV = nodes.reduce((s, n) => s + n.v, 0);
  if (sumV <= 0 || w <= 0 || h <= 0) return [];
  const area = w * h;
  const prepared: Prepared<T>[] = nodes
    .map((n) => ({ ...n, a: (n.v / sumV) * area, data: n.data }))
    .sort((a, b) => b.a - a.a);
  const out: TreemapLaidOutCell<T>[] = [];
  layRecursive(prepared, x, y, w, h, out);
  return out;
}

export function deflateRects<T extends { x: number; y: number; w: number; h: number }>(
  layout: T[],
  margin: number
): T[] {
  return layout.map((r) => ({
    ...r,
    x: r.x + margin,
    y: r.y + margin,
    w: Math.max(0, r.w - 2 * margin),
    h: Math.max(0, r.h - 2 * margin),
  }));
}

/** Severity for cell area: max(0.08, (o/t)²) with safe t */
export function treemapSeverity(o: number, t: number): number {
  const tt = Math.max(1, t);
  const r = o / tt;
  return Math.max(0.08, r * r);
}

export interface TreemapSupplyCellPayload {
  name: string;
  o: number;
  t: number;
}

export interface TreemapSupplyLayoutOptions {
  width: number;
  height: number;
  padding: number;
  genreGap: number;
  itemGap: number;
  genreLabelHeight: number;
}

const defaultOptions: TreemapSupplyLayoutOptions = {
  width: 320,
  height: 118,
  padding: 4,
  genreGap: 4,
  itemGap: 1.5,
  genreLabelHeight: 16,
};

/**
 * Single sector = category; inner cells = name groups (TOP5 item axis rows).
 */
export function layoutSupplyTreemap(
  cells: TreemapSupplyCellPayload[],
  options: Partial<TreemapSupplyLayoutOptions> = {}
): {
  sectorRect: { x: number; y: number; w: number; h: number };
  cellRects: Array<TreemapLaidOutCell<TreemapSupplyCellPayload>>;
  options: TreemapSupplyLayoutOptions;
} {
  const o = { ...defaultOptions, ...options };
  const W = o.width;
  const H = o.height;
  const pad = o.padding;
  const innerW = Math.max(0, W - 2 * pad);
  const innerH = Math.max(0, H - 2 * pad);

  const sectorRect = { x: pad, y: pad, w: innerW, h: innerH };

  const innerX = pad + o.genreGap / 2;
  const innerY = pad + o.genreLabelHeight + o.genreGap / 2;
  const innerCellW = Math.max(0, innerW - o.genreGap);
  const innerCellH = Math.max(0, innerH - o.genreLabelHeight - o.genreGap);

  const nodes = cells.map((c) => ({
    v: treemapSeverity(c.o, c.t),
    data: c,
  }));

  let laid = squarifyLayout(nodes, innerX, innerY, innerCellW, innerCellH);
  laid = deflateRects(laid, o.itemGap / 2);

  return {
    sectorRect,
    cellRects: laid,
    options: o,
  };
}
