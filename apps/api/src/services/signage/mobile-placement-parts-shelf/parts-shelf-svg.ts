import type { PartsShelfGridViewModel } from './parts-shelf-view-model.js';
import type { PartsShelfZoneId } from './shelf-zone-map.js';

const ZONE_FILL: Record<PartsShelfZoneId, string> = {
  nw: '#e8a33e',
  n: '#7b42e8',
  ne: '#c93e37',
  w: '#4ea357',
  c: '#6e7480',
  e: '#733d1e',
  sw: '#d9692d',
  s: '#3e6ee8',
  se: '#d9599b',
};

const BG = '#333333';
const INNER = 'rgba(15,23,42,0.94)';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ZONE_GRID_POS: Record<PartsShelfZoneId, { col: number; row: number }> = {
  nw: { col: 0, row: 0 },
  n: { col: 1, row: 0 },
  ne: { col: 2, row: 0 },
  w: { col: 0, row: 1 },
  c: { col: 1, row: 1 },
  e: { col: 2, row: 1 },
  sw: { col: 0, row: 2 },
  s: { col: 1, row: 2 },
  se: { col: 2, row: 2 },
};

/**
 * 9枠配膳部品棚サイネージ用 SVG（Sharp で JPEG 化）
 */
export function buildMobilePlacementPartsShelfGridSvg(vm: PartsShelfGridViewModel, width: number, height: number): string {
  const pad = Math.max(4, Math.round(height * 0.006));
  const gap = Math.max(4, Math.round(height * 0.006));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const cellW = (innerW - gap * 2) / 3;
  const cellH = (innerH - gap * 2) / 3;
  const scale = width / 1920;
  const fsHead = Math.round(13 * scale);
  const fsRow = Math.round(10 * scale);
  const fsCount = Math.round(11 * scale);
  const rCell = Math.round(10 * scale);
  const rInner = Math.round(8 * scale);
  const frame = 3;
  const innerPad = Math.round(5 * scale);
  const headerBarH = Math.round(30 * scale);

  const zoneById = new Map(vm.zones.map((z) => [z.zoneId, z]));

  const cells: string[] = [];
  for (const zoneId of Object.keys(ZONE_GRID_POS) as PartsShelfZoneId[]) {
    const pos = ZONE_GRID_POS[zoneId];
    const x = pad + pos.col * (cellW + gap);
    const y = pad + pos.row * (cellH + gap);
    const z = zoneById.get(zoneId);
    const fill = ZONE_FILL[zoneId];

    const innerX = x + frame;
    const innerY = y + frame;
    const innerWc = cellW - frame * 2;
    const innerHc = cellH - frame * 2;

    const countLabel =
      z == null
        ? '0 件'
        : z.omittedCount > 0
          ? `${z.rows.length} 件 +${z.omittedCount}省略`
          : `${z.totalCount} 件`;

    const rows = z?.rows ?? [];
    const bodyTop = innerY + innerPad + headerBarH;
    const bodyH = Math.max(0, innerHc - innerPad * 2 - headerBarH);
    const n = Math.max(rows.length, 1);
    const rowStep = Math.min(Math.max(fsRow + 4, 12 * scale), bodyH / n);

    const rowEls: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const textY = bodyTop + (i + 1) * rowStep - Math.round(2 * scale);
      const x0 = innerX + innerPad;
      const xSerial = x0;
      const xPart = innerX + innerWc * 0.11;
      const xMachine = innerX + innerWc - innerPad;
      rowEls.push(`
        <text x="${xSerial}" y="${textY}" fill="rgba(255,255,255,0.78)" font-size="${fsRow}" font-family="ui-monospace,Consolas,monospace" font-weight="700">${escapeXml(row.serial5)}</text>
        <text x="${xPart}" y="${textY}" fill="rgba(241,245,249,0.95)" font-size="${fsRow}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncatePart(row.partName, 24))}</text>
        <text x="${xMachine}" y="${textY}" text-anchor="end" fill="#ffffff" font-size="${fsRow}" font-family="ui-monospace,Consolas,monospace" font-weight="800">${escapeXml(row.machine10)}</text>
      `);
    }

    cells.push(`
      <g>
        <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="${rCell}" fill="${fill}" />
        <rect x="${innerX}" y="${innerY}" width="${innerWc}" height="${innerHc}" rx="${rInner}" fill="${INNER}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${innerX + innerPad}" y="${innerY + innerPad + fsHead}" fill="rgba(248,250,252,0.9)" font-size="${fsHead}" font-family="system-ui,sans-serif" font-weight="800">${escapeXml(z?.dirLabel ?? '')}</text>
        <text x="${innerX + innerWc - innerPad}" y="${innerY + innerPad + fsHead}" text-anchor="end" fill="rgba(148,163,184,0.95)" font-size="${fsCount}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(countLabel)}</text>
        ${rowEls.join('\n')}
      </g>
    `);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${BG}"/>
  ${cells.join('\n')}
</svg>`;
}

function truncatePart(s: string, maxChars: number): string {
  const t = s.trim();
  const chars = [...t];
  if (chars.length <= maxChars) return t;
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}
