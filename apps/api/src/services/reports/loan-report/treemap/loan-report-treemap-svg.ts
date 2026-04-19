import type {
  TreemapLaidOutCell,
  TreemapSupplyCellPayload,
  TreemapSupplyLayoutOptions,
} from './loan-report-treemap-layout.js';
import { treemapCellStyle } from './loan-report-treemap-cell-style.js';

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildSupplyTreemapSvg(params: {
  sectorTitle: string;
  cellRects: TreemapLaidOutCell<TreemapSupplyCellPayload>[];
  options: TreemapSupplyLayoutOptions;
}): string {
  const { sectorTitle, cellRects, options: o } = params;
  const W = o.width;
  const H = o.height;

  const pad = o.padding;
  const innerW = Math.max(0, W - 2 * pad);
  const titleY = pad + 11;

  let body = '';
  body += `<rect x="${pad}" y="${pad}" width="${innerW}" height="${Math.max(0, H - 2 * pad)}" rx="3" fill="#18181b" stroke="#3f3f46" stroke-width="0.8"/>`;
  body += `<text x="${pad + 6}" y="${titleY}" font-size="9" font-weight="800" fill="#a1a1aa" font-family="var(--sans)">${escapeXml(sectorTitle)}</text>`;

  for (const c of cellRects) {
    const { o: outN, t, name } = c.data;
    const st = treemapCellStyle(outN, t);
    body += `<rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" rx="2" fill="${st.fill}" stroke="rgba(0,0,0,0.35)" stroke-width="0.6"/>`;
    const fs = Math.max(5.5, Math.min(9.5, Math.sqrt(c.w * c.h) * 0.11));
    const nums = `${outN} / ${t}`;
    const cx = c.x + c.w / 2;
    const showName = c.h > 18 && c.w > 28;
    if (showName) {
      const nameFs = fs;
      const numFs = fs * 1.02;
      body += `<text x="${cx.toFixed(2)}" y="${(c.y + c.h / 2 - numFs * 0.35).toFixed(2)}" text-anchor="middle" font-size="${nameFs.toFixed(1)}" font-weight="800" fill="${st.textFill}" font-family="var(--sans)">${escapeXml(name)}</text>`;
      body += `<text x="${cx.toFixed(2)}" y="${(c.y + c.h / 2 + numFs * 0.85).toFixed(2)}" text-anchor="middle" font-size="${numFs.toFixed(1)}" font-weight="800" fill="${st.textFill}" font-family="var(--num)">${escapeXml(nums)}</text>`;
    } else if (c.h > 11) {
      body += `<text x="${cx.toFixed(2)}" y="${(c.y + c.h / 2 + fs * 0.28).toFixed(2)}" text-anchor="middle" font-size="${fs.toFixed(1)}" font-weight="800" fill="${st.textFill}" font-family="var(--num)">${escapeXml(`${outN}/${t}`)}</text>`;
    }
  }

  return `<svg class="supply-treemap-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="名寄せ需給ツリーマップ">${body}</svg>`;
}

export function buildEmptySupplyTreemapSvg(options: TreemapSupplyLayoutOptions): string {
  const W = options.width;
  const H = options.height;
  const pad = options.padding;
  const innerW = Math.max(0, W - 2 * pad);
  const innerH = Math.max(0, H - 2 * pad);
  return `<svg class="supply-treemap-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="需給データなし">
    <rect x="${pad}" y="${pad}" width="${innerW}" height="${innerH}" rx="3" fill="#18181b" stroke="#3f3f46" stroke-width="0.8"/>
    <text x="${(W / 2).toFixed(1)}" y="${(H / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="#64748b" font-family="var(--sans)">名寄せデータなし</text>
  </svg>`;
}
