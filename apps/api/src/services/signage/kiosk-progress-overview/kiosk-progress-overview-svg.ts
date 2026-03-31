import type { ProductionScheduleProgressOverviewSeibanItem } from '../../production-schedule/progress-overview-query.service.js';
import {
  formatDueDateForProgressSignage,
  isProgressDueOverdueForSignage,
  normalizeMachineNameForSignage,
} from './progress-overview-signage-format.js';
import {
  KIOSK_PROGRESS_GRID_COLUMNS,
  KIOSK_PROGRESS_GRID_ROWS,
  computeKioskProgressOverviewGridSlots,
} from './kiosk-progress-overview-layout.js';
import {
  PO_SIGNAGE_CARD_BG,
  PO_SIGNAGE_CARD_BORDER,
  PO_SIGNAGE_CHIP_DONE_BORDER,
  PO_SIGNAGE_CHIP_DONE_FILL,
  PO_SIGNAGE_CHIP_DONE_TEXT,
  PO_SIGNAGE_CHIP_TODO_BORDER,
  PO_SIGNAGE_CHIP_TODO_FILL,
  PO_SIGNAGE_CHIP_TODO_TEXT,
  PO_SIGNAGE_HEADER_BORDER,
  PO_SIGNAGE_ROW_BORDER,
  PO_SIGNAGE_TEXT_DUE_OVERDUE,
  PO_SIGNAGE_TEXT_MUTED,
  PO_SIGNAGE_TEXT_PRIMARY,
} from './progress-overview-signage-theme.js';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

function chipColors(isCompleted: boolean): { border: string; fill: string; text: string } {
  return isCompleted
    ? {
        border: PO_SIGNAGE_CHIP_DONE_BORDER,
        fill: PO_SIGNAGE_CHIP_DONE_FILL,
        text: PO_SIGNAGE_CHIP_DONE_TEXT,
      }
    : {
        border: PO_SIGNAGE_CHIP_TODO_BORDER,
        fill: PO_SIGNAGE_CHIP_TODO_FILL,
        text: PO_SIGNAGE_CHIP_TODO_TEXT,
      };
}

function estimateChipOuterWidth(resourceCd: string, chipFs: number): number {
  const len = resourceCd.length;
  return Math.max(chipFs * len * 0.62 + 8, chipFs * 1.8) + 4;
}

/**
 * キオスクの ProgressOverviewSeibanCard + ProgressOverviewPartRow に視覚的に揃えたサイネージ用 SVG（ヘッダー類なし）。
 * 製番カードは 4列×2段グリッド。部品名・納期の右に「資源チップ列」を幅として確保し、はみ出しは clipPath で隣へ出さない。
 */
export function buildKioskProgressOverviewSvg(
  items: ProductionScheduleProgressOverviewSeibanItem[],
  width: number,
  height: number
): string {
  const scale = width / 1920;
  const outerPad = Math.round(12 * scale);
  const colGap = Math.round(8 * scale);
  const rowGap = Math.round(8 * scale);

  const gridSlots = computeKioskProgressOverviewGridSlots({
    width,
    height,
    columns: KIOSK_PROGRESS_GRID_COLUMNS,
    rows: KIOSK_PROGRESS_GRID_ROWS,
    outerPad,
    colGap,
    rowGap,
  });

  const cardPad = Math.round(8 * scale);
  const headerH = Math.round(40 * scale);
  const dueColW = Math.round(78 * scale);
  const seibanFs = Math.round(14 * scale);
  const metaFs = Math.max(10, Math.round(11 * scale));
  const tableFs = Math.max(9, Math.round(11 * scale));
  const chipFs = Math.max(8, Math.round(10 * scale));
  const radius = Math.round(4 * scale);
  const zoneGap = Math.round(6 * scale) + Math.round(4 * scale);

  const clipDefs: string[] = [];

  const cardsSvg = items
    .map((item, slotIndex) => {
      const slot = gridSlots[slotIndex];
      if (!slot) {
        return '';
      }

      const { x0, y0, cardW, cardH } = slot;
      const innerW = cardW - 2 * cardPad;

      const maxPartRows = Math.max(1, item.parts.length);
      const bodyTop = y0 + cardPad + headerH;
      const bodyHeightAvailable = cardH - 2 * cardPad - headerH;
      const rowH = Math.min(
        Math.round(18 * scale),
        Math.max(Math.round(12 * scale), Math.floor(bodyHeightAvailable / maxPartRows))
      );

      let maxChipsRowOuterW = 0;
      for (const part of item.parts) {
        if (!part.processes.length) continue;
        let rowOuter = 0;
        for (const proc of part.processes) {
          rowOuter += estimateChipOuterWidth(proc.resourceCd, chipFs);
        }
        maxChipsRowOuterW = Math.max(maxChipsRowOuterW, rowOuter);
      }

      const minProdW = 40;
      const maxChipCol = Math.max(0, innerW - dueColW - minProdW - zoneGap);
      const chipColW =
        maxChipsRowOuterW <= 0
          ? 0
          : Math.min(Math.max(maxChipsRowOuterW, Math.round(36 * scale)), maxChipCol);
      const prodW = Math.max(minProdW, innerW - dueColW - chipColW - zoneGap);
      const productMaxChars = Math.max(8, Math.floor(prodW / (tableFs * 0.55)));

      const chipColumnX = x0 + cardPad + prodW + dueColW + Math.round(6 * scale);

      const seiban = escapeXml(item.fseiban);
      const machine = escapeXml(normalizeMachineNameForSignage(item.machineName) || '-');

      const headerSvg = `
        <text x="${x0 + cardPad}" y="${y0 + cardPad + seibanFs}"
          font-size="${seibanFs}" font-family="Consolas, monospace" fill="${PO_SIGNAGE_TEXT_PRIMARY}" font-weight="600">${seiban}</text>
        <text x="${x0 + cardPad}" y="${y0 + cardPad + seibanFs + metaFs + Math.round(2 * scale)}"
          font-size="${metaFs}" font-family="sans-serif" fill="${PO_SIGNAGE_TEXT_MUTED}">${machine}</text>
        <line x1="${x0 + cardPad}" y1="${y0 + cardPad + headerH - Math.round(4 * scale)}"
          x2="${x0 + cardW - cardPad}" y2="${y0 + cardPad + headerH - Math.round(4 * scale)}"
          stroke="${PO_SIGNAGE_HEADER_BORDER}" stroke-width="1" />
      `;

      let rowY = bodyTop;
      let partRowIdx = 0;
      const rowsSvg = item.parts
        .map((part) => {
          const productLabel = escapeXml(truncateChars(part.fhinmei?.trim() || '-', productMaxChars));
          const dueRaw = formatDueDateForProgressSignage(part.dueDate);
          const dueLabel = escapeXml(dueRaw || '');
          const dueFill = isProgressDueOverdueForSignage(part.dueDate)
            ? PO_SIGNAGE_TEXT_DUE_OVERDUE
            : PO_SIGNAGE_TEXT_PRIMARY;
          const fontWeight = isProgressDueOverdueForSignage(part.dueDate) ? '600' : '400';

          let chipX = chipColumnX;
          const chipYBase = rowY + rowH / 2;
          const clipId = `kpo-clip-s${slotIndex}-p${partRowIdx}`;
          partRowIdx += 1;

          const chipsSvg = part.processes
            .map((proc) => {
              const c = chipColors(proc.isCompleted);
              const label = escapeXml(proc.resourceCd);
              const innerCw = Math.max(chipFs * proc.resourceCd.length * 0.62 + 8, chipFs * 1.8);
              const cw = innerCw;
              const ch = chipFs + 6;
              const cx = chipX;
              const cy = chipYBase - ch / 2;
              chipX += cw + 4;
              return `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="3" ry="3"
                fill="${c.fill}" stroke="${c.border}" stroke-width="1" />
                <text x="${cx + cw / 2}" y="${cy + ch / 2 + chipFs * 0.05}" text-anchor="middle"
                  font-size="${chipFs}" font-family="sans-serif" fill="${c.text}" dominant-baseline="middle">${label}</text>`;
            })
            .join('');

          const clipH = Math.max(rowH, chipFs + 8);
          const clipY = rowY + (rowH - clipH) / 2;
          clipDefs.push(
            `<clipPath id="${clipId}"><rect x="${chipColumnX}" y="${clipY}" width="${chipColW}" height="${clipH}" /></clipPath>`
          );

          const lineY = rowY + rowH;
          const chipsWrapped =
            part.processes.length > 0
              ? `<g clip-path="url(#${clipId})">${chipsSvg}</g>`
              : '';

          const rowBlock = `
            <text x="${x0 + cardPad}" y="${rowY + rowH * 0.72}" font-size="${tableFs}" font-family="sans-serif"
              fill="${PO_SIGNAGE_TEXT_PRIMARY}">${productLabel}</text>
            <text x="${x0 + cardPad + prodW}" y="${rowY + rowH * 0.72}" font-size="${metaFs}" font-family="Consolas, monospace"
              fill="${dueFill}" font-weight="${fontWeight}">${dueLabel}</text>
            ${chipsWrapped}
            <line x1="${x0 + cardPad}" y1="${lineY}" x2="${x0 + cardW - cardPad}" y2="${lineY}"
              stroke="${PO_SIGNAGE_ROW_BORDER}" stroke-width="1" />
          `;
          rowY = lineY;
          return rowBlock;
        })
        .join('');

      return `
        <g>
          <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" ry="${radius}"
            fill="${PO_SIGNAGE_CARD_BG}" stroke="${PO_SIGNAGE_CARD_BORDER}" stroke-width="1" />
          ${headerSvg}
          ${rowsSvg}
        </g>
      `;
    })
    .join('');

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>${clipDefs.join('')}</defs>
      <rect width="100%" height="100%" fill="#020617" />
      ${cardsSvg}
    </svg>
  `;
}
