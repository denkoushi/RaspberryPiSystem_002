import type {
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardPartStatus,
  SelfInspectionMachineBoardResourceProgress,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import type { SelfInspectionMachineBoardOutcomeStatus } from '../../part-measurement/self-inspection-machine-board-outcome.js';
import {
  escapeXml,
  formatUpdatedAt,
  statusColor,
  statusLabel,
  truncateChars,
} from './self-inspection-machine-board-format.js';
import {
  SIMB_SIGNAGE_BG,
  SIMB_SIGNAGE_CARD_BG,
  SIMB_SIGNAGE_CARD_BORDER,
  SIMB_SIGNAGE_HEADER_BORDER,
  SIMB_SIGNAGE_PROGRESS_NEUTRAL,
  SIMB_SIGNAGE_PROGRESS_TRACK,
  SIMB_SIGNAGE_ROW_BORDER,
  SIMB_SIGNAGE_TEXT_MUTED,
  SIMB_SIGNAGE_TEXT_PRIMARY,
} from './self-inspection-machine-board-theme.js';
import {
  SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING,
  SELF_INSPECTION_MACHINE_BOARD_COLUMNS,
  SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT,
  SELF_INSPECTION_MACHINE_BOARD_RESOURCE_ROW_HEIGHT,
} from './layout-contracts.js';
import {
  computeSelfInspectionMachineBoardCardHeight,
  countSelfInspectionMachineBoardCardResources,
  flattenSummaryPageParts,
} from './self-inspection-machine-board-layout.js';

type BoardStatus = SelfInspectionMachineBoardPartStatus | SelfInspectionMachineBoardOutcomeStatus;

function normalizeStatus(status: BoardStatus | undefined): BoardStatus {
  return status ?? 'not_started';
}

function cardResources(card: SelfInspectionMachineBoardPartItem): SelfInspectionMachineBoardResourceProgress[] {
  if (card.resources && card.resources.length > 0) {
    return card.resources;
  }

  const resourceCds = card.resourceCds && card.resourceCds.length > 0 ? card.resourceCds : ['—'];
  return resourceCds.map((resourceCd, index) => ({
    resourceCd,
    confirmedEntryCount: index === 0 ? card.completedEntryCount : 0,
    completedEntryCount: index === 0 ? card.completedEntryCount : 0,
    requiredEntryCount: index === 0 ? card.requiredEntryCount : 0,
    progressLabel: index === 0 ? card.progressLabel : '0/0',
    status: 'not_started',
    outcome: 'not_started',
    scheduleRowIds: card.scheduleRowIds ?? [card.scheduleRowId],
  }));
}

function buildHeader(args: {
  updatedAt: Date;
  pageIndex: number;
  pageCount: number;
  width: number;
  scale: number;
}): string {
  const pad = Math.round(28 * args.scale);
  const headerH = Math.round(78 * args.scale);
  const titleFs = Math.max(20, Math.round(30 * args.scale));
  const metaFs = Math.max(12, Math.round(15 * args.scale));
  const pageLabel = args.pageCount > 0 ? `${args.pageIndex + 1} / ${args.pageCount}` : '0 / 0';
  return `
    <rect x="0" y="0" width="${args.width}" height="${headerH}" fill="${SIMB_SIGNAGE_BG}" />
    <line x1="${pad}" y1="${headerH - 1}" x2="${args.width - pad}" y2="${headerH - 1}" stroke="${SIMB_SIGNAGE_HEADER_BORDER}" />
    <text x="${pad}" y="${Math.round(40 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${titleFs}" font-family="sans-serif" font-weight="700">自主検査 部品別進捗</text>
    <text x="${args.width - pad}" y="${Math.round(40 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${metaFs}" font-family="sans-serif" text-anchor="end">更新 ${escapeXml(formatUpdatedAt(args.updatedAt))} · ${escapeXml(pageLabel)}</text>
  `;
}

function buildNeutralProgressBar(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  completed: number;
  required: number;
}): string {
  const ratio = args.required > 0 ? Math.min(1, Math.max(0, args.completed / args.required)) : 0;
  const fillW = Math.max(0, Math.round(args.width * ratio));
  return `
    <rect x="${args.x}" y="${args.y}" width="${args.width}" height="${args.height}" rx="${Math.round(args.height / 2)}" fill="${SIMB_SIGNAGE_PROGRESS_TRACK}" />
    <rect x="${args.x}" y="${args.y}" width="${fillW}" height="${args.height}" rx="${Math.round(args.height / 2)}" fill="${SIMB_SIGNAGE_PROGRESS_NEUTRAL}" />
  `;
}

function buildCardSvg(args: {
  card: SelfInspectionMachineBoardPartItem;
  machineName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}): string {
  const { card, scale } = args;
  const innerPad = Math.max(8, Math.round(SELF_INSPECTION_MACHINE_BOARD_CARD_PADDING * scale));
  const cardStatus = normalizeStatus(card.outcome ?? card.status);
  const resources = cardResources(card);
  const continuationLabel =
    card.isContinuation && card.continuationIndex != null && card.continuationCount != null
      ? ` 続き ${card.continuationIndex}/${card.continuationCount}`
      : '';
  const headerHeight = Math.round(SELF_INSPECTION_MACHINE_BOARD_CARD_HEADER_HEIGHT * scale);
  const rowAreaHeight = Math.max(0, args.height - innerPad * 2 - headerHeight);
  const preferredRowHeight = Math.round(SELF_INSPECTION_MACHINE_BOARD_RESOURCE_ROW_HEIGHT * scale);
  const minRowHeight = Math.max(14, Math.round(SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT * scale));
  const rowHeight = Math.max(
    minRowHeight,
    Math.min(preferredRowHeight, Math.floor(rowAreaHeight / Math.max(1, resources.length)))
  );
  const textFs = Math.max(11, Math.round(14 * scale));
  const smallFs = Math.max(10, Math.round(12 * scale));
  const badgeW = Math.round(92 * scale);
  const badgeH = Math.round(28 * scale);
  const badgeX = args.x + args.width - innerPad - badgeW;
  const titleY = args.y + innerPad + Math.round(22 * scale);
  const nameY = args.y + innerPad + Math.round(48 * scale);
  const machineY = args.y + innerPad + Math.round(72 * scale);
  const resourceX = args.x + innerPad;
  const barX = args.x + Math.round(args.width * 0.43);
  const barW = Math.max(
    Math.round(80 * scale),
    args.x + args.width - innerPad - barX - Math.round(78 * scale)
  );
  const labelX = args.x + args.width - innerPad;

  const resourceRows = resources
    .map((resource, index) => {
      const rowTop = args.y + innerPad + headerHeight + index * rowHeight;
      const rowTextY = rowTop + Math.max(Math.round(rowHeight * 0.68), smallFs);
      const barH = Math.max(7, Math.min(14, Math.round(rowHeight * 0.32)));
      return `
        <text x="${resourceX}" y="${rowTextY}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${smallFs}" font-family="sans-serif">資源CD ${escapeXml(truncateChars(resource.resourceCd, 14))}</text>
        ${buildNeutralProgressBar({
          x: barX,
          y: rowTop + Math.max(2, Math.round((rowHeight - barH) / 2)),
          width: barW,
          height: barH,
          completed: resource.confirmedEntryCount,
          required: resource.requiredEntryCount,
        })}
        <text x="${labelX}" y="${rowTextY}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${smallFs}" font-family="sans-serif" text-anchor="end">${escapeXml(resource.progressLabel)}</text>
      `;
    })
    .join('');

  return `
    <g data-simb-card="true">
      <rect x="${args.x}" y="${args.y}" width="${args.width}" height="${args.height}" rx="8" fill="${SIMB_SIGNAGE_CARD_BG}" stroke="${SIMB_SIGNAGE_CARD_BORDER}" />
      <text x="${resourceX}" y="${titleY}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${textFs}" font-family="sans-serif" font-weight="700">製番 ${escapeXml(truncateChars(card.fseiban, 18))}${escapeXml(continuationLabel)}</text>
      <rect x="${badgeX}" y="${args.y + innerPad}" width="${badgeW}" height="${badgeH}" rx="${Math.round(badgeH / 2)}" fill="${statusColor(cardStatus)}" />
      <text x="${badgeX + badgeW / 2}" y="${args.y + innerPad + Math.round(badgeH * 0.68)}" fill="#ffffff" font-size="${smallFs}" font-family="sans-serif" font-weight="700" text-anchor="middle">${escapeXml(statusLabel(cardStatus))}</text>
      <text x="${resourceX}" y="${nameY}" fill="${SIMB_SIGNAGE_TEXT_PRIMARY}" font-size="${textFs}" font-family="sans-serif">品名 ${escapeXml(truncateChars(card.fhinmei, 26))}</text>
      <text x="${resourceX}" y="${machineY}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${smallFs}" font-family="sans-serif">機種名 ${escapeXml(truncateChars(card.normalizedMachineName ?? card.machineName ?? args.machineName, 24))}</text>
      <line x1="${resourceX}" y1="${args.y + innerPad + headerHeight - Math.round(8 * scale)}" x2="${args.x + args.width - innerPad}" y2="${args.y + innerPad + headerHeight - Math.round(8 * scale)}" stroke="${SIMB_SIGNAGE_ROW_BORDER}" />
      ${resourceRows}
    </g>
  `;
}

function buildDetailCard(page: SelfInspectionMachineBoardDetailPage): SelfInspectionMachineBoardPartItem {
  const outcome =
    page.status === 'completed'
      ? 'pass'
      : page.status === 'review_pending'
        ? 'pending'
        : page.status;
  return {
    scheduleRowId: `${page.fseiban}::${page.fhincd}`,
    fseiban: page.fseiban,
    productNo: '',
    fhincd: page.fhincd,
    fhinmei: page.fhinmei,
    status: page.status,
    completedEntryCount: 0,
    requiredEntryCount: 1,
    progressLabel: page.progressLabel,
    dueDate: null,
    isScheduled: false,
    machineName: page.machineName,
    normalizedMachineName: page.machineName,
    outcome,
    resources: [],
  };
}

function buildPageSvg(args: {
  machineName: string;
  updatedAt: Date;
  pageIndex: number;
  pageCount: number;
  cards: SelfInspectionMachineBoardPartItem[];
  width: number;
  height: number;
}): string {
  const scale = args.width / 1920;
  const pad = Math.round(28 * scale);
  const headerH = Math.round(78 * scale);
  const bodyTop = headerH + Math.round(18 * scale);
  const bodyBottom = args.height - pad;
  const bodyHeight = Math.max(0, bodyBottom - bodyTop);
  const gap = Math.round(18 * scale);
  const cardW = Math.floor((args.width - pad * 2 - gap) / SELF_INSPECTION_MACHINE_BOARD_COLUMNS);
  const rows: SelfInspectionMachineBoardPartItem[][] = [];
  for (let index = 0; index < args.cards.length; index += SELF_INSPECTION_MACHINE_BOARD_COLUMNS) {
    rows.push(args.cards.slice(index, index + SELF_INSPECTION_MACHINE_BOARD_COLUMNS));
  }
  const desiredRowHeights = rows.map((row) =>
    Math.max(
      ...row.map((card) =>
        computeSelfInspectionMachineBoardCardHeight({
          resourceCount: countSelfInspectionMachineBoardCardResources(card),
          scale,
        })
      ),
      Math.round(160 * scale)
    )
  );
  const desiredTotal =
    desiredRowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0) +
    Math.max(0, rows.length - 1) * gap;
  const heightRatio = desiredTotal > bodyHeight && desiredTotal > 0 ? bodyHeight / desiredTotal : 1;
  let y = bodyTop;
  const cardsSvg = rows
    .map((row, rowIndex) => {
      const rowHeight = Math.max(
        Math.round(140 * scale),
        Math.floor((desiredRowHeights[rowIndex] ?? 160 * scale) * heightRatio)
      );
      const rowSvg = row
        .map((card, columnIndex) =>
          buildCardSvg({
            card,
            machineName: args.machineName,
            x: pad + columnIndex * (cardW + gap),
            y,
            width: cardW,
            height: rowHeight,
            scale,
          })
        )
        .join('');
      y += rowHeight + gap;
      return rowSvg;
    })
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${args.width}" height="${args.height}" viewBox="0 0 ${args.width} ${args.height}">
      <rect width="${args.width}" height="${args.height}" fill="${SIMB_SIGNAGE_BG}" />
      ${buildHeader({
        updatedAt: args.updatedAt,
        pageIndex: args.pageIndex,
        pageCount: args.pageCount,
        width: args.width,
        scale,
      })}
      ${cardsSvg || `<text x="${pad}" y="${bodyTop + Math.round(32 * scale)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${Math.max(14, Math.round(16 * scale))}" font-family="sans-serif">対象部品がありません</text>`}
    </svg>
  `.trim();
}

export function buildSelfInspectionMachineBoardSummarySvg(
  page: SelfInspectionMachineBoardSummaryPage,
  width: number,
  height: number
): string {
  return buildPageSvg({
    machineName: page.machineName,
    updatedAt: page.updatedAt,
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    cards: flattenSummaryPageParts(page),
    width,
    height,
  });
}

/** 旧 VM の detail 入力もカード一枚へ変換し、詳細ヒートストリップは描画しない。 */
export function buildSelfInspectionMachineBoardDetailSvg(
  page: SelfInspectionMachineBoardDetailPage,
  width: number,
  height: number
): string {
  return buildPageSvg({
    machineName: page.machineName,
    updatedAt: page.updatedAt,
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    cards: [buildDetailCard(page)],
    width,
    height,
  });
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
