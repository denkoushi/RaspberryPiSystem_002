import type {
  HeatstripCellTone,
  SelfInspectionMachineBoardPartStatus
} from '../../part-measurement/self-inspection-machine-board.types.js';
import type { SelfInspectionMachineBoardOutcomeStatus } from '../../part-measurement/self-inspection-machine-board-outcome.js';
import {
  SIMB_HEAT_CENTER,
  SIMB_HEAT_EDGE,
  SIMB_HEAT_MISSING,
  SIMB_HEAT_NEUTRAL,
  SIMB_HEAT_OUT,
} from './self-inspection-machine-board-theme.js';

const TOKYO_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function heatstripToneColor(tone: HeatstripCellTone): string {
  switch (tone) {
    case 'center':
      return SIMB_HEAT_CENTER;
    case 'edge':
      return SIMB_HEAT_EDGE;
    case 'out_of_tolerance':
      return SIMB_HEAT_OUT;
    case 'missing':
      return SIMB_HEAT_MISSING;
    case 'neutral':
    default:
      return SIMB_HEAT_NEUTRAL;
  }
}

export function statusColor(
  status: SelfInspectionMachineBoardPartStatus | SelfInspectionMachineBoardOutcomeStatus
): string {
  switch (status) {
    case 'pass':
    case 'completed':
      return '#22c55e';
    case 'rejected':
      return '#ef4444';
    case 'review_pending':
    case 'pending':
      return '#a855f7';
    case 'in_progress':
      return '#f59e0b';
    case 'not_started':
    default:
      return '#64748b';
  }
}

export function statusLabel(
  status: SelfInspectionMachineBoardPartStatus | SelfInspectionMachineBoardOutcomeStatus
): string {
  switch (status) {
    case 'pass':
    case 'completed':
      return '合格';
    case 'rejected':
      return '不合格';
    case 'review_pending':
    case 'pending':
      return '判定待ち';
    case 'in_progress':
      return '検査中';
    case 'not_started':
    default:
      return '未検査';
  }
}

export function formatUpdatedAt(value: Date): string {
  const parts = TOKYO_UPDATED_AT_FORMATTER.formatToParts(value).reduce<Record<string, string>>(
    (result, part) => {
      result[part.type] = part.value;
      return result;
    },
    {}
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export function buildScheduleRowCapNote(args: {
  scheduleRowCap?: number;
  scheduleRowHasMore?: boolean;
}): string {
  if (!args.scheduleRowHasMore || args.scheduleRowCap == null) {
    return '';
  }
  return ` · 日程上限 ${args.scheduleRowCap} 件（続きあり）`;
}

export function buildAutoTargetScanCapNote(args: {
  truncated?: boolean;
  hitScanCap?: boolean;
  scanRowCap?: number;
}): string {
  const notes: string[] = [];
  if (args.truncated) {
    notes.push('（候補上限超過）');
  }
  if (args.hitScanCap && args.scanRowCap != null && args.scanRowCap > 0) {
    notes.push(` · 自動選定走査上限 ${args.scanRowCap} 件（続きあり）`);
  }
  return notes.join('');
}

export function buildActiveSessionCapNote(args: {
  activeSessionLimit?: number;
  activeSessionHasMore?: boolean;
}): string {
  if (!args.activeSessionHasMore || args.activeSessionLimit == null) {
    return '';
  }
  return ` · 最新${args.activeSessionLimit}件を表示・続きあり`;
}

export function buildSelfInspectionMachineBoardPageCapNotes(
  page: {
    scheduleRowCap?: number;
    scheduleRowHasMore?: boolean;
    autoTargetTruncated?: boolean;
    autoTargetHitScanCap?: boolean;
    autoTargetScanRowCap?: number;
    activeSessionLimit?: number;
    activeSessionHasMore?: boolean;
  }
): string {
  const activeSessionNote = buildActiveSessionCapNote(page);
  return (
    buildAutoTargetScanCapNote({
      truncated: page.autoTargetTruncated,
      hitScanCap: page.autoTargetHitScanCap,
      scanRowCap: page.autoTargetScanRowCap,
    }) + (activeSessionNote || buildScheduleRowCapNote(page))
  );
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** SVG の sans-serif 表示幅を、ASCII と日本語の字幅差を考慮して概算する。 */
export function estimateTextWidth(value: string, fontSize: number): number {
  const size = Math.max(1, fontSize);
  return [...value].reduce(
    (width, character) =>
      width + ((character.codePointAt(0) ?? Number.POSITIVE_INFINITY) <= 0xff ? size * 0.6 : size),
    0
  );
}

/** 最大幅を超える文字列を、表示幅基準で省略記号付きにする。 */
export function truncateTextToWidth(
  value: string,
  maxWidth: number,
  fontSize: number
): string {
  if (value.length === 0 || maxWidth <= 0) {
    return '';
  }
  if (estimateTextWidth(value, fontSize) <= maxWidth) {
    return value;
  }

  const ellipsis = '…';
  if (estimateTextWidth(ellipsis, fontSize) > maxWidth) {
    return '';
  }

  let result = '';
  for (const character of value) {
    const candidate = `${result}${character}${ellipsis}`;
    if (estimateTextWidth(candidate, fontSize) > maxWidth) {
      break;
    }
    result += character;
  }
  return `${result}${ellipsis}`;
}

export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${value.slice(0, maxChars - 1)}…`;
}
