import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

function progressToken(rowData: unknown): string {
  if (rowData == null || typeof rowData !== 'object') return '';
  const p = (rowData as Record<string, unknown>).progress;
  return typeof p === 'string' ? p.trim() : '';
}

/**
 * 行 ID 列に加え、ユーザー入力が反映されるフィールドを含む指紋。
 * 同一 id 列でも順位・備考・納期・完了が変われば put する。
 */
export function fingerprintLeaderboardBoardContent(
  board: ProductionScheduleLeaderboardBoardResponse
): string {
  return board.rows
    .map((row) => {
      const due = row.dueDate != null ? String(row.dueDate).trim() : '';
      const order = row.processingOrder != null ? String(row.processingOrder) : '';
      const note = row.note != null ? String(row.note).trim() : '';
      return `${row.id}:${order}:${note}:${due}:${progressToken(row.rowData)}`;
    })
    .join('\u0002');
}

export function shouldSkipCachePut(input: {
  lastContentFingerprint: string | null;
  nextContentFingerprint: string;
}): boolean {
  if (input.lastContentFingerprint == null) return false;
  return input.lastContentFingerprint === input.nextContentFingerprint;
}
