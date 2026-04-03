import type { LoanGridRenderRequest } from '../loan-grid-rasterizer.port.js';
import { escapeHtml } from './html-escape.js';
function cardColors(view: { isInstrument: boolean; isRigging: boolean; isExceeded: boolean }): {
  bg: string;
  border: string;
  borderWidth: string;
} {
  let bg: string;
  let borderNormal: string;
  if (view.isInstrument) {
    bg = 'rgb(147,51,234)';
    borderNormal = 'rgb(107,33,168)';
  } else if (view.isRigging) {
    bg = 'rgb(249,115,22)';
    borderNormal = 'rgb(194,65,12)';
  } else {
    bg = 'rgb(59,130,246)';
    borderNormal = 'rgb(29,78,216)';
  }
  const border = view.isExceeded ? 'rgb(220,38,38)' : borderNormal;
  const borderWidth = view.isExceeded ? '4px' : '2px';
  return { bg, border, borderWidth };
}

function buildCompactCard(placed: {
    view: {
      primaryText: string;
      employeeName: string | null;
      clientLocation: string;
      borrowedCompact: string;
      managementText: string;
      riggingIdNumText: string;
      isExceeded: boolean;
      isInstrument: boolean;
      isRigging: boolean;
      thumbnailDataUrl: string | null;
    };
    width: number;
    height: number;
  },
  scale: number
): string {
  const { view, width: w, height: h } = placed;
  const c = cardColors(view);
  const pad = Math.round(12 * scale);
  const thumb = Math.round(96 * scale);
  const gap = Math.round(12 * scale);
  const radius = Math.round(12 * scale);
  const emp = view.employeeName?.trim() ? escapeHtml(view.employeeName.trim()) : escapeHtml('未割当');

  const thumbBlock = view.thumbnailDataUrl
    ? `<img class="thumb" src="${escapeHtml(view.thumbnailDataUrl)}" alt="" width="${thumb}" height="${thumb}" style="width:${thumb}px;height:${thumb}px;border-radius:${Math.round(8 * scale)}px;object-fit:cover;flex-shrink:0;" />`
    : `<div style="width:${thumb}px;height:${thumb}px;flex-shrink:0;"></div>`;

  const warn = view.isExceeded
    ? `<span style="font-weight:700;font-size:${Math.max(10, Math.round(11 * scale))}px;white-space:nowrap;">⚠ 期限超過</span>`
    : '';

  const riggingLine = view.riggingIdNumText
    ? `<div style="text-align:right;font-size:${Math.max(12, Math.round(12 * scale))}px;font-weight:600;">${escapeHtml(view.riggingIdNumText)}</div>`
    : '';

  const mgmt = escapeHtml(view.managementText || '');
  const borrowed = view.borrowedCompact ? escapeHtml(view.borrowedCompact) : '';

  return `
    <div class="loan-card compact" style="width:${w}px;height:${h}px;box-sizing:border-box;padding:${pad}px;border-radius:${radius}px;background:${c.bg};border:${c.borderWidth} solid ${c.border};overflow:hidden;display:flex;flex-direction:column;color:#fff;font-family:sans-serif;">
      <div style="font-weight:600;font-size:${Math.max(12, Math.round(14 * scale))}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:${Math.round(6 * scale)}px;">${emp}</div>
      <div style="display:flex;flex-direction:row;gap:${gap}px;flex:1;min-height:0;">
        ${thumbBlock}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${Math.round(4 * scale)}px;">
          <div style="font-weight:700;font-size:${Math.max(13, Math.round(16 * scale))}px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${escapeHtml(view.primaryText)}</div>
          <div style="font-weight:600;font-size:${Math.max(11, Math.round(12 * scale))}px;color:#e2e8f0;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${escapeHtml(view.clientLocation)}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:row;align-items:baseline;justify-content:space-between;gap:${Math.round(8 * scale)}px;margin-top:${Math.round(6 * scale)}px;flex-shrink:0;">
        <div style="display:flex;flex-direction:row;align-items:baseline;gap:${Math.round(8 * scale)}px;min-width:0;flex:1;">
          <span style="font-weight:600;font-size:${Math.max(11, Math.round(13 * scale))}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${borrowed}</span>
          ${warn}
        </div>
      </div>
      <div style="margin-top:auto;padding-top:${Math.round(4 * scale)}px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        ${riggingLine}
        <div style="font-family:monospace;font-weight:600;font-size:${Math.max(12, Math.round(13 * scale))}px;text-align:right;">${mgmt}</div>
      </div>
    </div>
  `;
}

function buildDefaultCard(
  placed: {
    view: {
      primaryText: string;
      employeeName: string | null;
      clientLocation: string;
      borrowedDatePart: string;
      borrowedTimePart: string;
      managementText: string;
      riggingIdNumText: string;
      isExceeded: boolean;
      isInstrument: boolean;
      isRigging: boolean;
      thumbnailDataUrl: string | null;
    };
    width: number;
    height: number;
  },
  scale: number
): string {
  const { view, width: w, height: h } = placed;
  const c = cardColors(view);
  const pad = Math.round(12 * scale);
  const thumb = Math.round(96 * scale);
  const gap = Math.round(12 * scale);
  const radius = Math.round(12 * scale);
  const hasThumb = Boolean(view.thumbnailDataUrl);
  const secondary = view.employeeName ? `${view.employeeName} さん` : '未割当';

  const thumbBlock = hasThumb
    ? `<img src="${escapeHtml(view.thumbnailDataUrl!)}" alt="" width="${thumb}" height="${thumb}" style="width:${thumb}px;height:${thumb}px;border-radius:${Math.round(8 * scale)}px;object-fit:cover;flex-shrink:0;" />`
    : '';

  const layoutRow = hasThumb
    ? `display:flex;flex-direction:row;gap:${gap}px;flex:1;min-height:0;`
    : 'display:flex;flex-direction:column;flex:1;min-height:0;';

  return `
    <div class="loan-card default" style="width:${w}px;height:${h}px;box-sizing:border-box;padding:${pad}px;border-radius:${radius}px;background:${c.bg};border:${c.borderWidth} solid ${c.border};overflow:hidden;display:flex;flex-direction:column;color:#fff;font-family:sans-serif;">
      <div style="${layoutRow}">
        ${thumbBlock}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${Math.round(4 * scale)}px;overflow:hidden;">
          <div style="font-weight:700;font-size:${Math.max(16, Math.round(18 * scale))}px;line-height:1.2;word-break:break-word;">${escapeHtml(view.primaryText)}</div>
          <div style="font-weight:600;font-size:${Math.max(14, Math.round(16 * scale))}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(secondary)}</div>
          <div style="font-weight:600;font-size:${Math.max(12, Math.round(13 * scale))}px;color:#e2e8f0;word-break:break-word;">${escapeHtml(view.clientLocation)}</div>
          <div style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:${Math.round(8 * scale)}px;font-weight:600;font-size:${Math.max(14, Math.round(14 * scale))}px;">
            ${view.borrowedDatePart ? `<span>${escapeHtml(view.borrowedDatePart)}</span>` : ''}
            ${view.borrowedTimePart ? `<span>${escapeHtml(view.borrowedTimePart)}</span>` : ''}
          </div>
          ${view.isExceeded ? `<div style="font-weight:700;font-size:${Math.max(14, Math.round(14 * scale))}px;">⚠ 期限超過</div>` : ''}
        </div>
      </div>
      <div style="margin-top:auto;padding-top:${Math.round(4 * scale)}px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        ${view.riggingIdNumText ? `<div style="font-weight:600;font-size:${Math.max(12, Math.round(12 * scale))}px;">${escapeHtml(view.riggingIdNumText)}</div>` : ''}
        <div style="font-family:monospace;font-weight:600;font-size:${Math.max(14, Math.round(14 * scale))}px;">${escapeHtml(view.managementText || '')}</div>
      </div>
    </div>
  `;
}

/**
 * Full HTML5 document for Playwright viewport capture. Transparent background for SVG compositing.
 */
export function buildLoanGridHtmlDocument(request: LoanGridRenderRequest): string {
  const { layout, config } = request;
  const { columns, gap, scale, placed, isEmpty } = layout;
  const w = Math.max(1, Math.ceil(config.width));
  const h = Math.max(1, Math.ceil(config.height));

  if (isEmpty) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      html,body{margin:0;padding:0;background:transparent;}
      .wrap{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-size:${Math.round(28 * scale)}px;}
    </style></head><body><div class="wrap">表示するアイテムがありません</div></body></html>`;
  }

  const cells = placed
    .map((p) => {
      const inner =
        config.cardLayout === 'splitCompact24'
          ? buildCompactCard(p, scale)
          : buildDefaultCard(p, scale);
      return `<div style="min-width:0;">${inner}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    html,body{margin:0;padding:0;background:transparent;}
    .grid{width:${w}px;height:${h}px;box-sizing:border-box;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:${gap}px;align-content:start;}
  </style></head><body><div class="grid">${cells}</div></body></html>`;
}
