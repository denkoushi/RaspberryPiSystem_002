import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';
import type { AccumulatedLeaderboardDecorations } from '../mergeLeaderboardBoardWithDecorations';

function progressToken(rowData: unknown): string {
  if (rowData == null || typeof rowData !== 'object') return '';
  const p = (rowData as Record<string, unknown>).progress;
  return typeof p === 'string' ? p.trim() : '';
}

function fingerprintProcessChangeResidual(board: ProductionScheduleLeaderboardBoardResponse): string {
  const rows = board.processChangeResidualRows ?? [];
  const rowTokens = rows
    .map((row) => {
      const evidence = row.processChangeResidualEvidence;
      if (!evidence) {
        return row.id;
      }
      return `${row.id}:${evidence.current.productNo}:${evidence.current.fkojun}:${evidence.current.resourceCd}:${evidence.current.status}:${evidence.current.fupdtedt ?? ''}:${evidence.completedOtherResource.productNo}:${evidence.completedOtherResource.fkojun}:${evidence.completedOtherResource.resourceCd}:${evidence.completedOtherResource.status}:${evidence.completedOtherResource.fupdtedt ?? ''}`;
    })
    .sort()
    .join(',');
  return `${board.processChangeResidualTotal ?? 0}:${board.processChangeResidualRepresentativeLimit ?? ''}:${rowTokens}`;
}

/**
 * 行 ID 列に加え、ユーザー入力が反映されるフィールドを含む指紋。
 * 同一 id 列でも順位・備考・納期・完了が変われば put する。
 */
export function fingerprintLeaderboardBoardContent(
  board: ProductionScheduleLeaderboardBoardResponse
): string {
  const rowPart = board.rows
    .map((row) => {
      const due = row.dueDate != null ? String(row.dueDate).trim() : '';
      const order = row.processingOrder != null ? String(row.processingOrder) : '';
      const note = row.note != null ? String(row.note).trim() : '';
      return `${row.id}:${order}:${note}:${due}:${progressToken(row.rowData)}`;
    })
    .join('\u0002');
  return `${rowPart}\u0003${fingerprintProcessChangeResidual(board)}`;
}

function fingerprintProcessChip(chip: {
  rowId: string;
  resourceCd: string;
  isCompleted: boolean;
  resourceNames?: string[];
}): string {
  const names =
    chip.resourceNames != null && chip.resourceNames.length > 0
      ? [...chip.resourceNames].sort().join(',')
      : '';
  return `${chip.rowId}:${chip.resourceCd}:${chip.isCompleted ? 1 : 0}:${names}`;
}

/**
 * 機種名・顧客名・資源CDフッタチップを含む装飾指紋。
 * チップのみ増えた場合も IDB put 対象になる。
 */
export function fingerprintLeaderboardBoardDecorations(
  decorations: AccumulatedLeaderboardDecorations
): string {
  const rowPart = [...decorations.rowDecorationsById.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([id, d]) =>
        `${id}:${d.resolvedMachineName ?? ''}:${d.customerName ?? ''}:${d.hasSelfInspectionDrawing ? 1 : 0}:${d.selfInspectionStatus ?? ''}:${d.selfInspectionEntryPath ?? ''}`
    )
    .join('\u0003');

  const chipPart = Object.keys(decorations.leaderboardFooterChipsByPartKey)
    .sort()
    .map((partKey) => {
      const processes = decorations.leaderboardFooterChipsByPartKey[partKey] ?? [];
      const procTokens = processes.map((p) => fingerprintProcessChip(p)).sort().join(',');
      return `${partKey}=[${procTokens}]`;
    })
    .join('\u0003');

  return `${rowPart}\u0004${chipPart}`;
}

/** @deprecated board のみ。新規は shouldSkipLeaderboardBoardCachePut を使用 */
export function shouldSkipCachePut(input: {
  lastContentFingerprint: string | null;
  nextContentFingerprint: string;
}): boolean {
  if (input.lastContentFingerprint == null) return false;
  return input.lastContentFingerprint === input.nextContentFingerprint;
}

/** board と decorations の両方が同一のときだけ IDB put をスキップ */
export function shouldSkipLeaderboardBoardCachePut(input: {
  lastBoardFingerprint: string | null;
  nextBoardFingerprint: string;
  lastDecorationsFingerprint: string | null;
  nextDecorationsFingerprint: string;
}): boolean {
  if (input.lastBoardFingerprint == null || input.lastDecorationsFingerprint == null) {
    return false;
  }
  return (
    input.lastBoardFingerprint === input.nextBoardFingerprint &&
    input.lastDecorationsFingerprint === input.nextDecorationsFingerprint
  );
}
