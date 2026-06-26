import type {
  HeatstripCellTone,
  SelfInspectionMachineBoardPartStatus
} from '../../part-measurement/self-inspection-machine-board.types.js';
import {
  SIMB_HEAT_CENTER,
  SIMB_HEAT_EDGE,
  SIMB_HEAT_MISSING,
  SIMB_HEAT_NEUTRAL,
  SIMB_HEAT_OUT,
} from './self-inspection-machine-board-theme.js';

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

export function statusColor(status: SelfInspectionMachineBoardPartStatus): string {
  switch (status) {
    case 'completed':
      return '#22c55e';
    case 'review_pending':
      return '#ef4444';
    case 'in_progress':
      return '#f59e0b';
    case 'not_started':
    default:
      return '#64748b';
  }
}

export function statusLabel(status: SelfInspectionMachineBoardPartStatus): string {
  switch (status) {
    case 'completed':
      return '完了';
    case 'review_pending':
      return '承認待ち';
    case 'in_progress':
      return '入力中';
    case 'not_started':
    default:
      return '未開始';
  }
}

export function formatUpdatedAt(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
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

export function buildSelfInspectionMachineBoardPageCapNotes(
  page: {
    scheduleRowCap?: number;
    scheduleRowHasMore?: boolean;
    autoTargetTruncated?: boolean;
    autoTargetHitScanCap?: boolean;
    autoTargetScanRowCap?: number;
  }
): string {
  return (
    buildAutoTargetScanCapNote({
      truncated: page.autoTargetTruncated,
      hitScanCap: page.autoTargetHitScanCap,
      scanRowCap: page.autoTargetScanRowCap,
    }) + buildScheduleRowCapNote(page)
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

export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${value.slice(0, maxChars - 1)}…`;
}
