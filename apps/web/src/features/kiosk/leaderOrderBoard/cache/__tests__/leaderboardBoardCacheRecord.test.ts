import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import { LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION } from '../leaderboardBoardCacheConstants';
import {
  buildLeaderboardBoardCacheRecord,
  fingerprintLeaderboardBoardRowIds,
  isCompleteLeaderboardBoardSnapshot,
  parseLeaderboardBoardCacheRecord,
  serializeAccumulatedDecorations,
  deserializeAccumulatedDecorations
} from '../leaderboardBoardCacheRecord';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(partial: Partial<ProductionScheduleLeaderboardBoardResponse>): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 0,
    rows: [],
    resources: [],
    ...partial
  };
}

function mkCacheRow(id: string, resourceCd = '305'): ProductionScheduleLeaderboardBoardResponse['rows'][number] {
  return {
    id,
    occurredAt: '2026-01-01T00:00:00.000Z',
    rowData: { FSIGENCD: resourceCd },
    machineRequiredMinutes: 100,
    laborRequiredMinutes: 0
  } as ProductionScheduleLeaderboardBoardResponse['rows'][number];
}

describe('leaderboardBoardCacheRecord', () => {
  it('完走版のみ build 可能', () => {
    const b = board({
      total: 2,
      rows: [mkCacheRow('a'), mkCacheRow('b')],
      resources: [{ resourceCd: '1', hasMore: false, total: 2, pageSize: 80 }]
    });
    expect(isCompleteLeaderboardBoardSnapshot(b)).toBe(true);
    const rec = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: b,
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    });
    expect(rec).not.toBeNull();
    expect(rec!.rowIdsFingerprint).toBe('a\u0001b');
  });

  it('hasMore ありは build 不可', () => {
    const b = board({
      total: 10,
      rows: [{ id: 'x' }] as ProductionScheduleLeaderboardBoardResponse['rows'],
      resources: [{ resourceCd: '1', hasMore: true, total: 10, pageSize: 80 }]
    });
    expect(isCompleteLeaderboardBoardSnapshot(b)).toBe(false);
    expect(
      buildLeaderboardBoardCacheRecord({
        cacheKey: 'k',
        siteKey: 's',
        paramsKey: 'p',
        board: b,
        decorations: createEmptyAccumulatedLeaderboardDecorations()
      })
    ).toBeNull();
  });

  it('残骸 summary pending は完走キャッシュとして保存しない', () => {
    const b = board({
      total: 1,
      rows: [mkCacheRow('a')],
      residualSummaryDeferred: true,
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
    });
    expect(isCompleteLeaderboardBoardSnapshot(b)).toBe(false);
    expect(
      buildLeaderboardBoardCacheRecord({
        cacheKey: 'k',
        siteKey: 's',
        paramsKey: 'p',
        board: b,
        decorations: createEmptyAccumulatedLeaderboardDecorations()
      })
    ).toBeNull();
  });

  it('Map 装飾の serialize/deserialize 往復', () => {
    const acc = createEmptyAccumulatedLeaderboardDecorations();
    acc.rowDecorationsById.set('r1', {
      resolvedMachineName: 'M',
      customerName: 'C',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-1',
      selfInspectionStatus: 'in_progress',
      selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/sessions/s1'
    });
    const ser = serializeAccumulatedDecorations(acc);
    const back = deserializeAccumulatedDecorations(ser);
    expect(back.rowDecorationsById.get('r1')).toEqual({
      resolvedMachineName: 'M',
      customerName: 'C',
      hasSelfInspectionDrawing: true,
      selfInspectionTemplateId: 'tpl-1',
      selfInspectionStatus: 'in_progress',
      selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/sessions/s1'
    });
  });

  it('deserialize は自主検査フィールド欠落を既定値で補完する', () => {
    const back = deserializeAccumulatedDecorations({
      rowDecorationsById: {
        r1: { resolvedMachineName: 'M', customerName: null }
      },
      leaderboardFooterChipsByPartKey: {}
    });
    expect(back.rowDecorationsById.get('r1')).toEqual({
      resolvedMachineName: 'M',
      customerName: null,
      hasSelfInspectionDrawing: false,
      selfInspectionTemplateId: null,
      selfInspectionStatus: null,
      selfInspectionEntryPath: null
    });
  });

  it('parse は旧 schemaVersion を拒否する', () => {
    const b = board({
      total: 1,
      rows: [mkCacheRow('x')],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
    });
    const rec = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: b,
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;
    expect(rec).not.toBeNull();
    expect(parseLeaderboardBoardCacheRecord({ ...rec!, schemaVersion: 2 })).toBeNull();
    expect(rec!.schemaVersion).toBe(LEADERBOARD_BOARD_CACHE_SCHEMA_VERSION);
  });

  it('build/parse は人工数メタデータ欠落を拒否する', () => {
    const b = board({
      total: 1,
      rows: [{ id: 'x', occurredAt: '2026-01-01', rowData: { FSIGENCD: '305' } }] as ProductionScheduleLeaderboardBoardResponse['rows'],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
    });
    expect(
      buildLeaderboardBoardCacheRecord({
        cacheKey: 'k',
        siteKey: 's',
        paramsKey: 'p',
        board: b,
        decorations: createEmptyAccumulatedLeaderboardDecorations()
      })
    ).toBeNull();
  });

  it('parse は fingerprint 不一致を拒否', () => {
    const b = board({
      total: 1,
      rows: [mkCacheRow('x')],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
    });
    const rec = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: b,
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;
    expect(rec).not.toBeNull();
    const tampered = { ...rec!, rowIdsFingerprint: 'wrong' };
    expect(parseLeaderboardBoardCacheRecord(tampered)).toBeNull();
    expect(parseLeaderboardBoardCacheRecord(rec)).not.toBeNull();
  });

  it('fingerprintLeaderboardBoardRowIds', () => {
    const b = board({
      rows: [{ id: '1' }, { id: '2' }] as ProductionScheduleLeaderboardBoardResponse['rows']
    });
    expect(fingerprintLeaderboardBoardRowIds(b)).toBe('1\u00012');
  });
});
