import type {
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPartStatus,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  buildScheduleRowCapNote,
  buildSelfInspectionMachineBoardPageCapNotes,
  escapeXml,
  formatUpdatedAt,
  heatstripToneColor,
  statusColor,
  statusLabel,
  truncateChars,
} from './self-inspection-machine-board-format.js';
import {
  SIMB_HEAT_LEGEND,
  SIMB_SIGNAGE_BG,
  SIMB_SIGNAGE_CARD_BG,
  SIMB_SIGNAGE_CARD_BORDER,
  SIMB_SIGNAGE_HEADER_BORDER,
  SIMB_SIGNAGE_ROW_BORDER,
  SIMB_SIGNAGE_TEXT_ACCENT,
  SIMB_SIGNAGE_TEXT_MUTED,
  SIMB_SIGNAGE_TEXT_PRIMARY,
} from './self-inspection-machine-board-theme.js';
import {
  MAX_HEATSTRIP_ENTRY_COLUMNS,
  SUMMARY_PART_ROWS_PER_PAGE,
} from './layout-contracts.js';
import {
  computeDetailRowHeight,
  computeSummaryRowHeight,
  countSummaryLayoutSlots,
} from './self-inspection-machine-board-layout.js';

function buildHeader(args: {
  title: string;
  subtitle: string;
  pageLabel: string;
  width: number;
  scale: number;
}): string {
  const pad = Math.round(24 * args.scale);
  const headerH = Math.round(72 * args.scale);
  const titleFs = Math.round(28 * args.scale);
  const metaFs = Math.max(12, Math.round(14 * args.scale));
  return `
    <rect x="0" y="0" width="${args.width}" height="${headerH}" fill="${SIMB_SIGNAGE_BG}" />
    <line x1="${pad}" y1="${headerH - 1}" x2="${args.width - pad}" y2="${headerH - 1}" stroke="${SIMB_SIGNAGE_HEADER_BORDER}" />
    <text x="${pad}" y="${Math.round(34 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${titleFs}" font-family="sans-serif" font-weight="700">${escapeXml(args.title)}</text>
    <text x="${pad}" y="${Math.round(56 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${metaFs}" font-family="sans-serif">${escapeXml(args.subtitle)}</text>
    <text x="${args.width - pad}" y="${Math.round(56 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_ACCENT}" font-size="${metaFs}" font-family="sans-serif" text-anchor="end">${escapeXml(args.pageLabel)}</text>
  `;
}

function buildProgressBar(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  completed: number;
  required: number;
  status: SelfInspectionMachineBoardPartStatus;
}): string {
  const ratio = args.required > 0 ? Math.min(1, args.completed / args.required) : 0;
  const fillW = Math.max(0, Math.round(args.width * ratio));
  const fillColor = statusColor(args.status);
  return `
    <rect x="${args.x}" y="${args.y}" width="${args.width}" height="${args.height}" rx="${Math.round(args.height / 2)}" fill="#1e293b" />
    <rect x="${args.x}" y="${args.y}" width="${fillW}" height="${args.height}" rx="${Math.round(args.height / 2)}" fill="${fillColor}" />
  `;
}

export function buildSelfInspectionMachineBoardSummarySvg(
  page: SelfInspectionMachineBoardSummaryPage,
  width: number,
  height: number
): string {
  const scale = width / 1920;
  const pad = Math.round(24 * scale);
  const headerH = Math.round(72 * scale);
  const bodyTop = headerH + Math.round(12 * scale);
  const bodyHeight = height - bodyTop - pad;
  const sectionFs = Math.max(12, Math.round(15 * scale));
  const sectionHeaderHeight = Math.round(sectionFs + 8 * scale);
  const groupGap = Math.round(8 * scale);
  const layout = countSummaryLayoutSlots(page);
  const rowH = computeSummaryRowHeight({
    bodyHeight,
    sectionCount: layout.sectionCount,
    partCount: layout.partCount,
    sectionHeaderHeight,
    groupGap,
    minRowHeight: Math.round(24 * scale),
  });
  const tableFs = Math.max(11, Math.round(13 * scale));
  const colSeibanW = Math.round(120 * scale);
  const colPartW = Math.round(110 * scale);
  const colNameW = Math.round(220 * scale);
  const colProgressW = Math.round(180 * scale);
  const colStatusW = Math.round(72 * scale);

  const allGroups = [...page.scheduled, ...page.unscheduled];
  let y = bodyTop;

  const rowsSvg = allGroups
    .flatMap((group, groupIndex) => {
      const sectionLabel =
        groupIndex < page.scheduled.length
          ? `製番 ${group.fseiban}`
          : `製番 ${group.fseiban}（納期未設定）`;
      const section = `
        <text x="${pad}" y="${y + Math.round(sectionFs * 0.8)}" fill="${SIMB_SIGNAGE_TEXT_ACCENT}" font-size="${sectionFs}" font-family="sans-serif" font-weight="700">${escapeXml(sectionLabel)}</text>
      `;
      y += sectionHeaderHeight;

      const partRows = group.parts
        .map((part) => {
          const rowTop = y;
          y += rowH;
          const progressX = pad + colSeibanW + colPartW + colNameW + Math.round(8 * scale);
          return `
            <rect x="${pad}" y="${rowTop}" width="${width - 2 * pad}" height="${rowH - 2}" fill="${SIMB_SIGNAGE_CARD_BG}" stroke="${SIMB_SIGNAGE_ROW_BORDER}" />
            <text x="${pad + 8}" y="${rowTop + Math.round(rowH * 0.62)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${tableFs}" font-family="sans-serif">${escapeXml(truncateChars(part.fseiban, 12))}</text>
            <text x="${pad + colSeibanW}" y="${rowTop + Math.round(rowH * 0.62)}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${tableFs}" font-family="sans-serif">${escapeXml(truncateChars(part.fhincd, 14))}</text>
            <text x="${pad + colSeibanW + colPartW}" y="${rowTop + Math.round(rowH * 0.62)}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${tableFs}" font-family="sans-serif">${escapeXml(truncateChars(part.fhinmei, 18))}</text>
            ${buildProgressBar({
              x: progressX,
              y: rowTop + Math.round(rowH * 0.35),
              width: colProgressW,
              height: Math.round(rowH * 0.3),
              completed: part.completedEntryCount,
              required: part.requiredEntryCount,
              status: part.status,
            })}
            <text x="${progressX + colProgressW + 8}" y="${rowTop + Math.round(rowH * 0.62)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${tableFs}" font-family="sans-serif">${escapeXml(part.progressLabel)}</text>
            <text x="${width - pad - colStatusW}" y="${rowTop + Math.round(rowH * 0.62)}" fill="${statusColor(part.status)}" font-size="${tableFs}" font-family="sans-serif">${escapeXml(statusLabel(part.status))}</text>
          `;
        })
        .join('');

      y += groupGap;
      return section + partRows;
    })
    .join('');

  const pageLabel =
    page.pageCount > 0 ? `${page.pageIndex + 1} / ${page.pageCount}` : '0 / 0';
  const scheduleCapNote = buildScheduleRowCapNote(page);
  const overflowNote =
    layout.partCount > SUMMARY_PART_ROWS_PER_PAGE
      ? `<text x="${pad}" y="${height - pad}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${Math.max(10, Math.round(11 * scale))}" font-family="sans-serif">${escapeXml(`表示上限 ${SUMMARY_PART_ROWS_PER_PAGE} 行（全 ${layout.partCount} 件）`)}</text>`
      : scheduleCapNote.length > 0
        ? `<text x="${pad}" y="${height - pad}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${Math.max(10, Math.round(11 * scale))}" font-family="sans-serif">${escapeXml(scheduleCapNote.trim())}</text>`
        : '';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <clipPath id="simb-summary-body-clip">
          <rect x="0" y="${bodyTop}" width="${width}" height="${bodyHeight}" />
        </clipPath>
      </defs>
      <rect width="${width}" height="${height}" fill="${SIMB_SIGNAGE_BG}" />
      ${buildHeader({
        title: `自主検査 ${page.machineName}`,
        subtitle: `更新 ${formatUpdatedAt(page.updatedAt)} · 仕掛中 進捗一覧${buildSelfInspectionMachineBoardPageCapNotes(page)}`,
        pageLabel,
        width,
        scale,
      })}
      <g clip-path="url(#simb-summary-body-clip)">
        ${rowsSvg || `<text x="${pad}" y="${bodyTop + 40}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${sectionFs}" font-family="sans-serif">対象部品がありません</text>`}
      </g>
      ${overflowNote}
    </svg>
  `.trim();
}

export function buildSelfInspectionMachineBoardDetailSvg(
  page: SelfInspectionMachineBoardDetailPage,
  width: number,
  height: number
): string {
  const scale = width / 1920;
  const pad = Math.round(24 * scale);
  const headerH = Math.round(72 * scale);
  const bodyTop = headerH + Math.round(16 * scale);
  const labelFs = Math.max(11, Math.round(13 * scale));
  const titleFs = Math.max(14, Math.round(18 * scale));
  const labelColW = Math.round(180 * scale);
  const maxCellCount = Math.min(
    MAX_HEATSTRIP_ENTRY_COLUMNS + 1,
    Math.max(1, ...page.measurementPoints.map((point) => point.cells.length), 1)
  );
  const cellW = Math.max(
    Math.round(20 * scale),
    Math.floor((width - 2 * pad - labelColW) / maxCellCount)
  );

  let y = bodyTop;
  const meta = `
    <text x="${pad}" y="${y}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${titleFs}" font-family="sans-serif" font-weight="700">${escapeXml(`${page.fhincd} · ${truncateChars(page.fhinmei, 24)}`)}</text>
  `;
  y += Math.round(titleFs + 8 * scale);
  const sub = `
    <text x="${pad}" y="${y}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${labelFs}" font-family="sans-serif">${escapeXml(`製番 ${page.fseiban} · ${statusLabel(page.status)} · ${page.progressLabel}`)}</text>
  `;
  y += Math.round(labelFs + 16 * scale);

  const legendY = height - pad - Math.round(28 * scale);
  const heatAreaTop = y;
  const heatAreaHeight = Math.max(0, legendY - heatAreaTop - Math.round(16 * scale));
  const rowCount = page.measurementPoints.length;
  const rowH = computeDetailRowHeight({
    heatAreaHeight,
    rowCount,
    minRowHeight: Math.round(30 * scale),
    maxRowHeight: Math.round(36 * scale),
  });
  const legendSvg = SIMB_HEAT_LEGEND.map((item, index) => {
    const x = pad + index * Math.round(170 * scale);
    return `
      <rect x="${x}" y="${legendY}" width="${Math.round(14 * scale)}" height="${Math.round(14 * scale)}" fill="${item.color}" rx="2" />
      <text x="${x + Math.round(20 * scale)}" y="${legendY + Math.round(12 * scale)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${Math.max(10, Math.round(11 * scale))}" font-family="sans-serif">${escapeXml(`${item.symbol} ${item.label}`)}</text>
    `;
  }).join('');

  const heatRows = page.measurementPoints
    .map((point) => {
      const rowTop = y;
      y += rowH;
      const cells = point.cells
        .map((cell, cellIndex) => {
          const x = pad + labelColW + cellIndex * cellW;
          return `
            <rect x="${x}" y="${rowTop}" width="${cellW - 2}" height="${rowH - 4}" fill="${heatstripToneColor(cell.tone)}" rx="3" />
            <title>${escapeXml(`${cell.entryLabel}: ${cell.displayValue ?? '未入力'}`)}</title>
          `;
        })
        .join('');
      return `
        <text x="${pad}" y="${rowTop + Math.round(rowH * 0.65)}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${labelFs}" font-family="sans-serif">${escapeXml(truncateChars(point.label, 16))}</text>
        ${cells}
      `;
    })
    .join('');

  const pageLabel =
    page.pageCount > 0 ? `${page.pageIndex + 1} / ${page.pageCount}` : '0 / 0';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <clipPath id="simb-detail-heat-clip">
          <rect x="${pad}" y="${heatAreaTop}" width="${width - 2 * pad}" height="${heatAreaHeight}" />
        </clipPath>
      </defs>
      <rect width="${width}" height="${height}" fill="${SIMB_SIGNAGE_BG}" />
      ${buildHeader({
        title: `自主検査 ${page.machineName}`,
        subtitle: `更新 ${formatUpdatedAt(page.updatedAt)} · 測定点別ヒートストリップ${buildSelfInspectionMachineBoardPageCapNotes(page)}`,
        pageLabel,
        width,
        scale,
      })}
      ${meta}
      ${sub}
      <rect x="${pad}" y="${heatAreaTop}" width="${width - 2 * pad}" height="${heatAreaHeight}" fill="${SIMB_SIGNAGE_CARD_BG}" stroke="${SIMB_SIGNAGE_CARD_BORDER}" rx="6" />
      <g clip-path="url(#simb-detail-heat-clip)">
        ${heatRows || `<text x="${pad}" y="${heatAreaTop + Math.round(rowH * 0.65)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${labelFs}" font-family="sans-serif">詳細データがありません</text>`}
      </g>
      ${legendSvg}
    </svg>
  `.trim();
}

export function buildSelfInspectionMachineBoardSvg(
  page: SelfInspectionMachineBoardSummaryPage | SelfInspectionMachineBoardDetailPage,
  width: number,
  height: number
): string {
  if (page.kind === 'detail') {
    return buildSelfInspectionMachineBoardDetailSvg(page, width, height);
  }
  return buildSelfInspectionMachineBoardSummarySvg(page, width, height);
}
