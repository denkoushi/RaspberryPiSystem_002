import type { LoanCardViewModel } from '../loan-card-grid.dto.js';
import { resolveCompactThumbPlan } from '../compact-thumb-plan.js';
import type { LoanGridRenderRequest } from '../loan-grid-rasterizer.port.js';
import { buildCompactKioskMiddleHtml } from './compact-loan-card-kiosk-html.js';
import { computeCompactCardHtmlTokens, computeDefaultCardHtmlTokens } from './grid-card-html-tokens.js';
import { escapeHtml } from './html-escape.js';
import { resolveLoanCardChrome } from './loan-card-chrome.js';

function buildCompactCard(placed: { view: LoanCardViewModel; width: number; height: number }, scale: number): string {
  const { view, width: w, height: h } = placed;
  const chrome = resolveLoanCardChrome(view);
  const t = computeCompactCardHtmlTokens(scale);
  const emp = view.employeeName?.trim() ? escapeHtml(view.employeeName.trim()) : escapeHtml('未割当');
  const plan = resolveCompactThumbPlan(view);

  const thumbBlock =
    plan.kind === 'image'
      ? `<img class="thumb" src="${escapeHtml(plan.dataUrl)}" alt="" width="${t.thumbPx}" height="${t.thumbPx}" style="width:${t.thumbPx}px;height:${t.thumbPx}px;border-radius:${t.thumbCornerPx}px;object-fit:cover;flex-shrink:0;" />`
      : plan.kind === 'itemEmptySlot'
        ? `<div style="width:${t.thumbPx}px;height:${t.thumbPx}px;flex-shrink:0;"></div>`
        : '';

  const kioskLines = view.compactKioskLines;
  const useKioskBody = kioskLines != null;
  const middleInner = kioskLines
    ? buildCompactKioskMiddleHtml(kioskLines, view.clientLocation, t)
    : `<div style="font-weight:700;font-size:${t.nameAndPrimaryPx}px;line-height:1.25;flex:0 1 auto;min-height:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${escapeHtml(view.primaryText)}</div>
          <div style="font-weight:600;font-size:${t.locationPx}px;color:#e2e8f0;line-height:1.2;flex:1 1 0;min-height:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${escapeHtml(view.clientLocation)}</div>`;

  const middleRowStyle =
    plan.kind === 'hidden'
      ? `display:flex;flex-direction:row;gap:${t.innerGapPx}px;flex:1 1 0;min-height:0;align-items:flex-start;overflow:hidden;`
      : `display:flex;flex-direction:row;gap:${t.innerGapPx}px;height:${t.thumbPx}px;flex-shrink:0;align-items:flex-start;overflow:hidden;`;

  const warn = view.isExceeded
    ? `<span style="font-weight:700;font-size:${t.warnPx}px;white-space:nowrap;">⚠ 期限超過</span>`
    : '';

  const riggingLine =
    !useKioskBody && view.riggingIdNumText
      ? `<div style="text-align:right;font-size:${t.riggingPx}px;font-weight:600;">${escapeHtml(view.riggingIdNumText)}</div>`
      : '';

  const mgmt = escapeHtml(view.managementText || '');
  const borrowed = view.borrowedCompact ? escapeHtml(view.borrowedCompact) : '';
  const showFooterCodeColumn = !useKioskBody;

  const footerRight = showFooterCodeColumn
    ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;text-align:right;">
          ${riggingLine}
          <div style="font-family:monospace;font-weight:600;font-size:${t.mgmtPx}px;line-height:1;">${mgmt}</div>
        </div>`
    : '';

  /**
   * 工具: 従来どおり空サムネ列＋ primary＋右下コード。
   * 計測・吊具（キオスク行）: 写真が無いときサムネ列なし、本文は管理番号→名称（吊具は同一行右に id）、フッタ右の重複コードは出さない。
   */
  return `
    <div class="loan-card compact" style="width:${w}px;height:${h}px;box-sizing:border-box;padding:${t.padPx}px;border-radius:${t.cardRadiusPx}px;background:${chrome.background};border:${chrome.borderWidth} solid ${chrome.borderColor};overflow:hidden;display:flex;flex-direction:column;color:#fff;font-family:sans-serif;">
      <div style="font-weight:600;font-size:${t.nameAndPrimaryPx}px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:${t.nameMarginBottomPx}px;flex-shrink:0;">${emp}</div>
      <div style="${middleRowStyle}">
        ${thumbBlock}
        <div style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;gap:${t.stackGapPx}px;overflow:hidden;">
          ${middleInner}
        </div>
      </div>
      <div style="margin-top:auto;flex-shrink:0;display:flex;flex-direction:row;align-items:flex-end;justify-content:space-between;gap:${t.footerRowGapPx}px;padding-top:${t.footerPadTopPx}px;">
        <div style="display:flex;flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:${t.footerRowGapPx}px;min-width:0;">
          <span style="font-weight:600;font-size:${t.borrowedPx}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${borrowed}</span>
          ${warn}
        </div>
        ${footerRight}
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
  const chrome = resolveLoanCardChrome(view);
  const t = computeDefaultCardHtmlTokens(scale);
  const hasThumb = Boolean(view.thumbnailDataUrl);
  const secondary = view.employeeName ? `${view.employeeName} さん` : '未割当';

  const thumbBlock = hasThumb
    ? `<img src="${escapeHtml(view.thumbnailDataUrl!)}" alt="" width="${t.thumbPx}" height="${t.thumbPx}" style="width:${t.thumbPx}px;height:${t.thumbPx}px;border-radius:${t.thumbCornerPx}px;object-fit:cover;flex-shrink:0;" />`
    : '';

  const layoutRow = hasThumb
    ? `display:flex;flex-direction:row;gap:${t.innerGapPx}px;flex:1;min-height:0;`
    : 'display:flex;flex-direction:column;flex:1;min-height:0;';

  return `
    <div class="loan-card default" style="width:${w}px;height:${h}px;box-sizing:border-box;padding:${t.padPx}px;border-radius:${t.cardRadiusPx}px;background:${chrome.background};border:${chrome.borderWidth} solid ${chrome.borderColor};overflow:hidden;display:flex;flex-direction:column;color:#fff;font-family:sans-serif;">
      <div style="${layoutRow}">
        ${thumbBlock}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${t.stackGapPx}px;overflow:hidden;">
          <div style="font-weight:700;font-size:${t.primaryPx}px;line-height:1.2;word-break:break-word;">${escapeHtml(view.primaryText)}</div>
          <div style="font-weight:600;font-size:${t.secondaryPx}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(secondary)}</div>
          <div style="font-weight:600;font-size:${t.locationPx}px;color:#e2e8f0;word-break:break-word;">${escapeHtml(view.clientLocation)}</div>
          <div style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:${t.footerRowGapPx}px;font-weight:600;font-size:${t.borrowPx}px;">
            ${view.borrowedDatePart ? `<span>${escapeHtml(view.borrowedDatePart)}</span>` : ''}
            ${view.borrowedTimePart ? `<span>${escapeHtml(view.borrowedTimePart)}</span>` : ''}
          </div>
          ${view.isExceeded ? `<div style="font-weight:700;font-size:${t.exceededPx}px;">⚠ 期限超過</div>` : ''}
        </div>
      </div>
      <div style="margin-top:auto;padding-top:${t.footerPadTopPx}px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        ${view.riggingIdNumText ? `<div style="font-weight:600;font-size:${t.riggingPx}px;">${escapeHtml(view.riggingIdNumText)}</div>` : ''}
        <div style="font-family:monospace;font-weight:600;font-size:${t.mgmtPx}px;">${escapeHtml(view.managementText || '')}</div>
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
