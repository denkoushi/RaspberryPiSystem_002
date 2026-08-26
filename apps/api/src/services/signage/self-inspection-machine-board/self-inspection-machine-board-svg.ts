import type {
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardPartStatus,
  SelfInspectionMachineBoardResourceProgress,
  SelfInspectionMachineBoardSummaryPage,
} from '../../part-measurement/self-inspection-machine-board.types.js';
import type { SelfInspectionMachineBoardOutcomeStatus } from '../../part-measurement/self-inspection-machine-board-outcome.js';
import {
  buildSelfInspectionMachineBoardPageCapNotes,
  escapeXml,
  estimateTextWidth,
  formatUpdatedAt,
  statusColor,
  statusLabel,
  truncateTextToWidth,
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
  computeSelfInspectionMachineBoardCenteredRectY,
  computeSelfInspectionMachineBoardCenteredY,
  computeSelfInspectionMachineBoardResourceRowsTop,
  countSelfInspectionMachineBoardCardResources,
  flattenSummaryPageParts,
} from './self-inspection-machine-board-layout.js';

type BoardStatus = SelfInspectionMachineBoardPartStatus | SelfInspectionMachineBoardOutcomeStatus;

/** 第1波の型へ後続で追加される表示名を、型所有範囲外でも先行参照する。 */
type ResourceWithDisplayName = SelfInspectionMachineBoardResourceProgress & {
  resourceDisplayName?: string;
};

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

function resourceDisplayName(resource: SelfInspectionMachineBoardResourceProgress): string {
  const displayName = (resource as ResourceWithDisplayName).resourceDisplayName?.trim();
  return displayName || '名称未登録';
}

function buildHeader(args: {
  pageIndex: number;
  pageCount: number;
  width: number;
  scale: number;
  capNote?: string;
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
    <text x="${args.width - pad}" y="${Math.round(40 * args.scale)}" fill="${SIMB_SIGNAGE_TEXT_MUTED}" font-size="${metaFs}" font-family="sans-serif" text-anchor="end">${escapeXml(pageLabel)}${escapeXml(args.capNote ?? '')}</text>
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
  updatedAt: Date;
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
  const minRowHeight = Math.max(
    Math.round(14 * scale),
    Math.round(SELF_INSPECTION_MACHINE_BOARD_MIN_RESOURCE_ROW_HEIGHT * scale)
  );
  const rowHeight = Math.max(
    minRowHeight,
    Math.min(preferredRowHeight, Math.floor(rowAreaHeight / Math.max(1, resources.length)))
  );
  const fseibanFs = Math.max(16, Math.round(36 * scale));
  const fhinmeiFs = Math.max(14, Math.round(36 * scale));
  const machineFs = Math.max(12, Math.round(16 * scale));
  const resourceFs = Math.max(12, Math.round(31 * scale));
  const progressFs = Math.max(16, Math.round(36 * scale));
  const dateFs = Math.max(12, Math.round(27 * scale));
  const badgeFs = Math.max(12, Math.round(16 * scale));
  const badgeW = Math.round(112 * scale);
  const badgeH = Math.round(32 * scale);
  const badgeX = args.x + args.width - innerPad - badgeW;
  const cardHeaderTop = args.y + innerPad;
  const headerTextBandHeight = Math.floor(headerHeight / 2);
  const headerTextY = computeSelfInspectionMachineBoardCenteredY({
    top: cardHeaderTop,
    height: headerTextBandHeight,
  });
  const nameY = computeSelfInspectionMachineBoardCenteredY({
    top: cardHeaderTop + headerTextBandHeight,
    height: headerHeight - headerTextBandHeight,
  });
  const badgeY = computeSelfInspectionMachineBoardCenteredRectY({
    top: cardHeaderTop,
    height: headerTextBandHeight,
    itemHeight: badgeH,
  });
  const machineGap = Math.round(2 * machineFs);
  const resourceX = args.x + innerPad;
  const labelX = args.x + args.width - innerPad;
  const cardUpdatedAt = card.updatedAt;
  const cardDate =
    cardUpdatedAt instanceof Date && !Number.isNaN(cardUpdatedAt.getTime())
      ? cardUpdatedAt
      : args.updatedAt;
  const cardDateText = formatUpdatedAt(cardDate);
  const dateX = badgeX - Math.round(14 * scale);
  const dateWidth = estimateTextWidth(cardDateText, dateFs);
  const topRowRight = dateX - dateWidth - Math.round(12 * scale);
  const continuationWidth = estimateTextWidth(continuationLabel, fseibanFs);
  const machineName = card.normalizedMachineName ?? card.machineName ?? args.machineName;
  const machineNaturalWidth = estimateTextWidth(machineName, machineFs);
  const fseibanWidth = Math.max(
    fseibanFs,
    topRowRight - resourceX - machineGap - Math.max(machineFs, machineNaturalWidth)
  );
  const fseibanText = truncateTextToWidth(
    card.fseiban,
    Math.max(fseibanFs, fseibanWidth - continuationWidth),
    fseibanFs
  );
  const machineX =
    resourceX + estimateTextWidth(`${fseibanText}${continuationLabel}`, fseibanFs) + machineGap;
  const machineWidth = Math.max(machineFs, topRowRight - machineX);
  const baselineBarX = args.x + Math.round(args.width * 0.43);
  const baselineBarW = Math.max(
    Math.round(80 * scale),
    labelX - baselineBarX - Math.round(78 * scale)
  );
  const barX = args.x + Math.round(args.width * 0.55);
  const progressGap = Math.round(18 * scale);
  const progressCountWidth = Math.max(
    ...resources.map((resource) => estimateTextWidth(resource.progressLabel, progressFs)),
    estimateTextWidth('0/0', progressFs)
  );
  const availableBarW = Math.max(0, labelX - barX - progressGap - progressCountWidth);
  const barW = Math.max(0, Math.min(Math.round(baselineBarW * 0.7), availableBarW));
  const nameWidth = Math.max(fhinmeiFs, labelX - resourceX);
  const resourceNameWidth = Math.max(
    resourceFs,
    barX - resourceX - Math.round(12 * scale)
  );
  const resourceRowsTop = computeSelfInspectionMachineBoardResourceRowsTop({
    top: cardHeaderTop + headerHeight,
    height: rowAreaHeight,
    rowHeight,
    rowCount: resources.length,
  });

  const resourceRows = resources
    .map((resource, index) => {
      const rowTop = resourceRowsTop + index * rowHeight;
      const rowTextY = computeSelfInspectionMachineBoardCenteredY({
        top: rowTop,
        height: rowHeight,
      });
      const barH = Math.max(
        Math.round(7 * scale),
        Math.min(Math.round(14 * scale), Math.round(rowHeight * 0.32))
      );
      const barY = computeSelfInspectionMachineBoardCenteredRectY({
        top: rowTop,
        height: rowHeight,
        itemHeight: barH,
      });
      return `
        <text x="${resourceX}" y="${rowTextY}" fill="#ffffff" font-size="${resourceFs}" font-family="sans-serif" dominant-baseline="middle">${escapeXml(truncateTextToWidth(resourceDisplayName(resource), resourceNameWidth, resourceFs))}</text>
        ${buildNeutralProgressBar({
          x: barX,
          y: barY,
          width: barW,
          height: barH,
          completed: resource.confirmedEntryCount,
          required: resource.requiredEntryCount,
        })}
        <text x="${labelX}" y="${rowTextY}" fill="#ffffff" font-size="${progressFs}" font-family="sans-serif" text-anchor="end" dominant-baseline="middle">${escapeXml(resource.progressLabel)}</text>
      `;
    })
    .join('');

  return `
    <g data-simb-card="true">
      <rect x="${args.x}" y="${args.y}" width="${args.width}" height="${args.height}" rx="8" fill="${SIMB_SIGNAGE_CARD_BG}" stroke="${SIMB_SIGNAGE_CARD_BORDER}" />
      <text x="${resourceX}" y="${headerTextY}" fill="#ffffff" font-size="${fseibanFs}" font-family="sans-serif" font-weight="700" dominant-baseline="middle">${escapeXml(fseibanText)}${escapeXml(continuationLabel)}</text>
      <text x="${machineX}" y="${headerTextY}" fill="#ffffff" font-size="${machineFs}" font-family="sans-serif" dominant-baseline="middle">${escapeXml(truncateTextToWidth(machineName, machineWidth, machineFs))}</text>
      <text x="${dateX}" y="${headerTextY}" fill="#ffffff" font-size="${dateFs}" font-family="sans-serif" text-anchor="end" dominant-baseline="middle">${escapeXml(cardDateText)}</text>
      <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${Math.round(badgeH / 2)}" fill="${statusColor(cardStatus)}" />
      <text x="${badgeX + badgeW / 2}" y="${computeSelfInspectionMachineBoardCenteredY({ top: badgeY, height: badgeH })}" fill="#ffffff" font-size="${badgeFs}" font-family="sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeXml(statusLabel(cardStatus))}</text>
      <text x="${resourceX}" y="${nameY}" fill="#ffffff" font-size="${fhinmeiFs}" font-family="sans-serif" dominant-baseline="middle">${escapeXml(truncateTextToWidth(card.fhinmei, nameWidth, fhinmeiFs))}</text>
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
  capNote?: string;
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
  const minimumCardHeight = computeSelfInspectionMachineBoardCardHeight({
    resourceCount: 1,
    scale,
  });
  const desiredRowHeights = rows.map((row) =>
    Math.max(
      ...row.map((card) =>
        computeSelfInspectionMachineBoardCardHeight({
          resourceCount: countSelfInspectionMachineBoardCardResources(card),
          scale,
        })
      ),
      minimumCardHeight
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
        minimumCardHeight,
        Math.floor((desiredRowHeights[rowIndex] ?? minimumCardHeight) * heightRatio)
      );
      const rowSvg = row
        .map((card, columnIndex) =>
          buildCardSvg({
            card,
            machineName: args.machineName,
            updatedAt: args.updatedAt,
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
        pageIndex: args.pageIndex,
        pageCount: args.pageCount,
        width: args.width,
        scale,
        capNote: args.capNote,
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
    capNote: buildSelfInspectionMachineBoardPageCapNotes(page),
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
    capNote: buildSelfInspectionMachineBoardPageCapNotes(page),
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
