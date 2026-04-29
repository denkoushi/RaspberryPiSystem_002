import type { VisibleSeibanEntry } from './deriveVisibleSeibanEntries';

/**
 * 製番一覧パネル表示用に並べ替える。
 * - 共有履歴に登録済みの製番を先頭へ
 * - 同一グループ内は製番文字列の昇順（numeric 比較）
 */
export function sortVisibleSeibanEntriesForDisplay(
  entries: readonly VisibleSeibanEntry[],
  registered: ReadonlySet<string>
): VisibleSeibanEntry[] {
  return [...entries].sort((a, b) => {
    const ra = registered.has(a.fseiban) ? 0 : 1;
    const rb = registered.has(b.fseiban) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.fseiban.localeCompare(b.fseiban, undefined, { numeric: true });
  });
}
