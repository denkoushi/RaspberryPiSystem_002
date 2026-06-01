import { describe, expect, it } from 'vitest';

import {
  buildLeaderboardPartKeyFromScheduleRow,
  buildLeaderboardRowDecorationProgressToken,
  listLeaderboardRowIdsNeedingDecorationFetch,
  removeLeaderboardFetchedDecorationProgressTokens,
  removeLeaderboardFetchedFooterSyncTokensForRows,
  resolveStaleDecorationRowIds
} from '../leaderboardDecorationStalePolicy';

const staleOptionsEmpty = {
  boardNetworkSyncToken: '',
  footerFetchedBoardSyncTokenByPartKey: new Map<string, string>()
};

describe('leaderboardDecorationStalePolicy', () => {
  it('completion mutation のみ stale 対象 rowId を返す', () => {
    expect(
      resolveStaleDecorationRowIds({
        kind: 'completion',
        rowId: 'row-1',
        rowData: { progress: '完了' }
      })
    ).toEqual(['row-1']);
  });

  it('order / note / dueDate では stale 対象を返さない', () => {
    expect(
      resolveStaleDecorationRowIds({ kind: 'order', rowId: 'row-1', processingOrder: 1 })
    ).toEqual([]);
    expect(
      resolveStaleDecorationRowIds({ kind: 'note', rowId: 'row-1', note: 'x' })
    ).toEqual([]);
    expect(
      resolveStaleDecorationRowIds({ kind: 'dueDate', rowId: 'row-1', dueDate: '2026-06-01' })
    ).toEqual([]);
  });

  it('removeLeaderboardFetchedDecorationProgressTokens は取得済みトークンを削除する', () => {
    const map = new Map([
      ['a', ''],
      ['b', '完了']
    ]);
    removeLeaderboardFetchedDecorationProgressTokens(map, ['b', 'missing']);
    expect([...map.keys()]).toEqual(['a']);
  });

  it('listLeaderboardRowIdsNeedingDecorationFetch は未取得と progress 変化を pending にする', () => {
    const rows = [
      { id: 'a', seibanJoinKey: 'S1', rowData: { progress: '', ProductNo: '1', FHINCD: 'P1' } },
      { id: 'b', seibanJoinKey: 'S1', rowData: { progress: '完了', ProductNo: '2', FHINCD: 'P2' } },
      { id: 'c', seibanJoinKey: 'S2', rowData: { ProductNo: '3', FHINCD: 'P3' } }
    ];
    const fetched = new Map<string, string>([['b', '']]);
    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, fetched, staleOptionsEmpty)
    ).toEqual(['a', 'b', 'c']);
    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, new Map([['b', '完了']]), staleOptionsEmpty)
    ).toEqual(['a', 'c']);
  });

  it('board 再同期トークンが変わると表示行の partKey footer を再取得対象にする', () => {
    const rows = [
      {
        id: 'visible-a',
        seibanJoinKey: 'S1',
        rowData: { progress: '', ProductNo: '1', FHINCD: 'P1' }
      }
    ];
    const partKey = buildLeaderboardPartKeyFromScheduleRow(rows[0]!);
    const progressFetched = new Map([['visible-a', '']]);
    const footerFetched = new Map([[partKey, 'sync-v1']]);

    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, progressFetched, {
        boardNetworkSyncToken: 'sync-v1',
        footerFetchedBoardSyncTokenByPartKey: footerFetched
      })
    ).toEqual([]);

    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, progressFetched, {
        boardNetworkSyncToken: 'sync-v2',
        footerFetchedBoardSyncTokenByPartKey: footerFetched
      })
    ).toEqual(['visible-a']);
  });

  it('同一 partKey の複数表示行でも footer 再取得は代表 row 1 件のみ', () => {
    const rows = [
      {
        id: 'row-a',
        seibanJoinKey: 'S1',
        rowData: { progress: '', ProductNo: '1', FHINCD: 'P1' }
      },
      {
        id: 'row-b',
        seibanJoinKey: 'S1',
        rowData: { progress: '', ProductNo: '1', FHINCD: 'P1' }
      }
    ];
    const partKey = buildLeaderboardPartKeyFromScheduleRow(rows[0]!);
    const progressFetched = new Map([
      ['row-a', ''],
      ['row-b', '']
    ]);
    const footerFetched = new Map([[partKey, 'sync-v1']]);

    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, progressFetched, {
        boardNetworkSyncToken: 'sync-v2',
        footerFetchedBoardSyncTokenByPartKey: footerFetched
      })
    ).toEqual(['row-a']);
  });

  it('progress 再取得が入る partKey では footer 用の代表 row を重複追加しない', () => {
    const rows = [
      {
        id: 'row-a',
        seibanJoinKey: 'S1',
        rowData: { progress: '', ProductNo: '1', FHINCD: 'P1' }
      },
      {
        id: 'row-b',
        seibanJoinKey: 'S1',
        rowData: { progress: '完了', ProductNo: '1', FHINCD: 'P1' }
      }
    ];
    const partKey = buildLeaderboardPartKeyFromScheduleRow(rows[0]!);
    const progressFetched = new Map([['row-a', '']]);
    const footerFetched = new Map([[partKey, 'sync-v1']]);

    expect(
      listLeaderboardRowIdsNeedingDecorationFetch(rows, progressFetched, {
        boardNetworkSyncToken: 'sync-v2',
        footerFetchedBoardSyncTokenByPartKey: footerFetched
      })
    ).toEqual(['row-b']);
  });

  it('removeLeaderboardFetchedFooterSyncTokensForRows は partKey の footer 同期記録を削除する', () => {
    const rows = [
      {
        id: 'visible-a',
        seibanJoinKey: 'S1',
        rowData: { ProductNo: '1', FHINCD: 'P1' }
      }
    ];
    const partKey = buildLeaderboardPartKeyFromScheduleRow(rows[0]!);
    const footerMap = new Map([[partKey, 'sync-v1']]);
    removeLeaderboardFetchedFooterSyncTokensForRows(footerMap, rows, ['visible-a']);
    expect(footerMap.size).toBe(0);
  });

  it('buildLeaderboardRowDecorationProgressToken は progress 文字列を正規化する', () => {
    expect(buildLeaderboardRowDecorationProgressToken({ rowData: { progress: ' 完了 ' } })).toBe(
      '完了'
    );
    expect(buildLeaderboardRowDecorationProgressToken({ rowData: {} })).toBe('');
  });
});
